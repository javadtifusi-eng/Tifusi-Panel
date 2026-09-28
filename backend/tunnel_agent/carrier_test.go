package main

import (
	"encoding/binary"
	"net"
	"strings"
	"testing"
	"time"
)

func TestValidSpoofCarrier(t *testing.T) {
	for _, ok := range []string{"udp", "icmp", "tcp"} {
		if !validSpoofCarrier(ok) {
			t.Errorf("validSpoofCarrier(%q) = false, want true", ok)
		}
	}
	for _, bad := range []string{"", "quic", "UDP", "sctp"} {
		if validSpoofCarrier(bad) {
			t.Errorf("validSpoofCarrier(%q) = true, want false", bad)
		}
	}
}

func TestBuildSpoofedICMPWellFormed(t *testing.T) {
	src := net.ParseIP("8.8.8.8")
	dst := net.ParseIP("1.1.1.1")
	payload := []byte("hello-icmp-carrier")
	pkt, err := buildSpoofedICMP(src, dst, icmpTunnelID, 7, payload)
	if err != nil {
		t.Fatal(err)
	}

	// IP header checksum re-sums to zero when already correct.
	if s := onesComplementSum(pkt[0:20]); s != 0 {
		t.Errorf("IP header checksum invalid: re-sum = %#x, want 0", s)
	}
	if pkt[9] != 1 { // IPPROTO_ICMP
		t.Errorf("IP protocol = %d, want 1 (ICMP)", pkt[9])
	}
	if got := net.IP(pkt[12:16]).String(); got != "8.8.8.8" {
		t.Errorf("source IP = %s, want 8.8.8.8", got)
	}

	icmp := pkt[20:]
	if icmp[0] != 0 || icmp[1] != 0 {
		t.Errorf("ICMP type/code = %d/%d, want 0/0 (Echo Reply)", icmp[0], icmp[1])
	}
	if id := binary.BigEndian.Uint16(icmp[4:6]); id != icmpTunnelID {
		t.Errorf("ICMP id = %#x, want %#x", id, icmpTunnelID)
	}
	// ICMP checksum covers header+payload and re-sums to zero.
	if s := onesComplementSum(icmp); s != 0 {
		t.Errorf("ICMP checksum invalid: re-sum = %#x, want 0", s)
	}
	if got := string(icmp[8:]); got != string(payload) {
		t.Errorf("ICMP payload = %q, want %q", got, payload)
	}
}

func TestBuildSpoofedTCPWellFormed(t *testing.T) {
	src := net.ParseIP("8.8.8.8")
	dst := net.ParseIP("1.1.1.1")
	payload := []byte("hello-tcp-carrier")
	const seq, ack = 0x11223344, 0x55667788
	pkt, err := buildSpoofedTCP(src, dst, 443, 8443, seq, ack, payload)
	if err != nil {
		t.Fatal(err)
	}

	if s := onesComplementSum(pkt[0:20]); s != 0 {
		t.Errorf("IP header checksum invalid: re-sum = %#x, want 0", s)
	}
	if pkt[9] != 6 { // IPPROTO_TCP
		t.Errorf("IP protocol = %d, want 6 (TCP)", pkt[9])
	}

	tcp := pkt[20:]
	if sp := binary.BigEndian.Uint16(tcp[0:2]); sp != 443 {
		t.Errorf("TCP src port = %d, want 443", sp)
	}
	if dp := binary.BigEndian.Uint16(tcp[2:4]); dp != 8443 {
		t.Errorf("TCP dst port = %d, want 8443", dp)
	}
	if s := binary.BigEndian.Uint32(tcp[4:8]); s != seq {
		t.Errorf("TCP seq = %#x, want %#x", s, uint32(seq))
	}
	if a := binary.BigEndian.Uint32(tcp[8:12]); a != ack {
		t.Errorf("TCP ack = %#x, want %#x", a, uint32(ack))
	}
	if tcp[13] != 0x18 {
		t.Errorf("TCP flags = %#x, want 0x18 (PSH|ACK)", tcp[13])
	}
	// Shaped like an established Linux connection: DF, a real-looking window
	// and the timestamp option, not the fixed 0xFFFF/no-options tell.
	if pkt[6]&0x40 == 0 {
		t.Error("DF bit not set")
	}
	if w := binary.BigEndian.Uint16(tcp[14:16]); w == 0xffff {
		t.Errorf("TCP window = %#x, want a scaled-looking value", w)
	}
	if off := int(tcp[12]>>4) * 4; off != 32 {
		t.Fatalf("TCP data offset = %d, want 32 (header + timestamp option)", off)
	}
	if _, ok := tcpTSval(tcp[20:32]); !ok {
		t.Error("TCP timestamp option missing")
	}
	if got := string(tcp[32:]); got != string(payload) {
		t.Errorf("TCP payload = %q, want %q", got, payload)
	}

	// TCP checksum verifies over the pseudo-header + segment, re-summing to 0.
	pseudo := make([]byte, 12+len(tcp))
	copy(pseudo[0:4], src.To4())
	copy(pseudo[4:8], dst.To4())
	pseudo[9] = 6
	binary.BigEndian.PutUint16(pseudo[10:12], uint16(len(tcp)))
	copy(pseudo[12:], tcp)
	if s := onesComplementSum(pseudo); s != 0 {
		t.Errorf("TCP checksum invalid: re-sum = %#x, want 0", s)
	}
}

func TestStealthDecorateAndPin(t *testing.T) {
	off := (*spoofOpts)(nil)
	if off.on() || !off.allowSrc(net.ParseIP("9.9.9.9")) {
		t.Fatal("nil opts must be inert: stealth off, every source allowed")
	}
	if p := off.srcPort(443); p != 443 {
		t.Errorf("nil opts srcPort = %d, want the default 443", p)
	}

	st := &spoofOpts{stealth: true, peerSrcs: newPeerSrcs([]net.IP{net.ParseIP("5.6.7.8")})}

	// A random high source port, never the fixed default, always in range.
	for i := 0; i < 200; i++ {
		p := st.srcPort(443)
		if p < 1024 {
			t.Fatalf("stealth srcPort %d below the ephemeral range", p)
		}
	}

	// decorate rewrites TTL/DSCP and keeps the IP checksum valid.
	pkt, err := buildSpoofedUDP(net.ParseIP("1.1.1.1"), net.ParseIP("2.2.2.2"), 40000, 443, []byte("data"))
	if err != nil {
		t.Fatal(err)
	}
	st.decorate(pkt)
	if pkt[8] != 64 && pkt[8] != 128 && pkt[8] != 255 {
		t.Errorf("stealth TTL = %d, want one of 64/128/255", pkt[8])
	}
	if pkt[1]&0x03 != 0 {
		t.Errorf("ECN bits must stay 0, got byte %#x", pkt[1])
	}
	if s := onesComplementSum(pkt[0:20]); s != 0 {
		t.Errorf("IP checksum invalid after decorate: re-sum %#x", s)
	}

	// Peer-source pin: only the configured source is allowed through.
	if !st.allowSrc(net.ParseIP("5.6.7.8").To4()) {
		t.Error("pinned source should be allowed")
	}
	if st.allowSrc(net.ParseIP("5.6.7.9").To4()) {
		t.Error("non-pinned source should be rejected")
	}
}

func TestSpoofOptsSessionStable(t *testing.T) {
	s := (&spoofOpts{stealth: true}).session()
	if s.ttl == 0 || s.sport < 1024 {
		t.Fatalf("session did not draw stealth values: %+v", s)
	}
	first := s.srcPort(443)
	pkt1, pkt2 := make([]byte, 20), make([]byte, 20)
	pkt1[0], pkt2[0] = 0x45, 0x45
	s.decorate(pkt1)
	for i := 0; i < 50; i++ {
		if p := s.srcPort(443); p != first {
			t.Fatalf("srcPort changed within a session: %d then %d", first, p)
		}
		s.decorate(pkt2)
		if pkt2[8] != pkt1[8] || pkt2[1] != pkt1[1] {
			t.Fatalf("TTL/DSCP changed within a session")
		}
	}
	if (*spoofOpts)(nil).session() != nil {
		t.Error("nil opts session should stay nil")
	}
}

func TestSpoofOptsPeerPool(t *testing.T) {
	ips, err := parseSpoofSources("5.6.7.8, 10.0.0.0/30")
	if err != nil {
		t.Fatal(err)
	}
	o := &spoofOpts{peerSrcs: newPeerSrcs(ips)}
	for _, a := range []string{"5.6.7.8", "10.0.0.2"} {
		if !o.allowSrc(net.ParseIP(a)) {
			t.Errorf("%s should pass the pool pin", a)
		}
	}
	if o.allowSrc(net.ParseIP("10.0.0.9")) {
		t.Error("10.0.0.9 is outside the pool and must be dropped")
	}
}

func TestSplitCarrierPair(t *testing.T) {
	cases := []struct{ name, tx, rx string }{
		{"tcp", "tcp", "tcp"},
		{"tcp>icmpv6", "tcp", "icmpv6"},
		{"", "", ""},
	}
	for _, c := range cases {
		if tx, rx := splitCarrierPair(c.name); tx != c.tx || rx != c.rx {
			t.Errorf("splitCarrierPair(%q) = %q, %q", c.name, tx, rx)
		}
	}
	if got := carrierPair("udp", "udp"); got != "udp" {
		t.Errorf("carrierPair(udp, udp) = %q", got)
	}
	if got := carrierPair("udp", ""); got != "udp" {
		t.Errorf("carrierPair(udp, \"\") = %q", got)
	}
	if got := carrierPair("tcp", "icmpv6"); got != "tcp>icmpv6" {
		t.Errorf("carrierPair(tcp, icmpv6) = %q", got)
	}
	// A pair with tcp on either side gets tcp's smaller MTU.
	if carrierMTU("icmpv6>tcp") != carrierMTU(carrierTCP) || carrierMTU("udp>icmpv6") != carrierMTU(carrierUDP) {
		t.Error("carrierMTU ignores one side of a pair")
	}
}

func TestBuildSpoofedEchoICMPv6(t *testing.T) {
	pkt, err := buildSpoofedEcho(ipProtoICMPv6, 129, net.ParseIP("5.6.7.8"), net.ParseIP("1.1.1.1"), 7, 9, []byte("hi"))
	if err != nil {
		t.Fatal(err)
	}
	if pkt[9] != ipProtoICMPv6 || pkt[20] != 129 {
		t.Fatalf("proto %d type %d, want 58/129", pkt[9], pkt[20])
	}
	if s := onesComplementSum(pkt[0:20]); s != 0 {
		t.Errorf("IP header checksum invalid: %#x", s)
	}
	if s := onesComplementSum(pkt[20:]); s != 0 {
		t.Errorf("echo checksum invalid: %#x", s)
	}
}

func TestTCPCarrierPerSourceFlows(t *testing.T) {
	peer := &net.UDPAddr{IP: net.ParseIP("1.1.1.1"), Port: 8443}
	c := &tcpCarrier{port: 443, peer: peer, start: time.Now(), flows: map[[4]byte]*tcpFlow{}}
	a, b := net.ParseIP("8.8.8.8"), net.ParseIP("9.9.9.9")
	seqOf := func(src net.IP, n int) (uint32, uint16) {
		pkt, err := c.frame(src, make([]byte, n))
		if err != nil {
			t.Fatal(err)
		}
		return binary.BigEndian.Uint32(pkt[24:28]), binary.BigEndian.Uint16(pkt[4:6])
	}
	a1, aID1 := seqOf(a, 100)
	b1, _ := seqOf(b, 50)
	a2, aID2 := seqOf(a, 10)
	b2, _ := seqOf(b, 10)
	// Traffic on one forged source must not move another's sequence space.
	if a2-a1 != 100 || b2-b1 != 50 {
		t.Errorf("per-source seq advanced by %d/%d, want 100/50", a2-a1, b2-b1)
	}
	if aID2 != aID1+1 {
		t.Errorf("IP id went %d -> %d, want +1 within one flow", aID1, aID2)
	}
}

func TestTCPTSval(t *testing.T) {
	opts := []byte{1, 1, 8, 10, 0, 0, 0, 42, 0, 0, 0, 7}
	if v, ok := tcpTSval(opts); !ok || v != 42 {
		t.Errorf("tcpTSval = %d,%v, want 42,true", v, ok)
	}
	for _, bad := range [][]byte{nil, {1, 1}, {8, 10, 0}, {2, 0, 8, 10}, {0, 8, 10, 0, 0, 0, 1, 0, 0, 0, 0}} {
		if _, ok := tcpTSval(bad); ok {
			t.Errorf("tcpTSval(%v) found a timestamp", bad)
		}
	}
}

func TestTCPCarrierRSTRuleSparesRealResets(t *testing.T) {
	peer := &net.UDPAddr{IP: net.ParseIP("1.1.1.1"), Port: 8443}
	opts := &spoofOpts{peerSrcs: newPeerSrcs([]net.IP{net.ParseIP("9.9.9.9"), net.ParseIP("8.8.8.8")})}
	c := &tcpCarrier{port: 443, peer: peer, opts: opts}
	var rst, notrack string
	for _, r := range c.fwRules() {
		if r.table == "" && r.chain == "OUTPUT" {
			rst = r.String()
		}
		if r.table == "raw" && r.chain == "PREROUTING" {
			notrack = r.String()
		}
	}
	// A real service's own resets carry ACK; only bare RSTs aimed at the
	// pinned sources are ours to drop.
	if !strings.Contains(rst, "--tcp-flags RST,ACK RST") || !strings.Contains(rst, "-d 8.8.8.8,9.9.9.9") {
		t.Errorf("RST rule = %q", rst)
	}
	if !strings.Contains(notrack, "-s 8.8.8.8,9.9.9.9 -p tcp --dport 443 -j NOTRACK") {
		t.Errorf("NOTRACK rule = %q", notrack)
	}
}
