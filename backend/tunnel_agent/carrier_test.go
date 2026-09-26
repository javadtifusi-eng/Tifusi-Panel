package main

import (
	"encoding/binary"
	"net"
	"testing"
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
	if got := string(tcp[20:]); got != string(payload) {
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
