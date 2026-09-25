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
