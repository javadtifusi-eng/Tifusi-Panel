package main

import (
	"encoding/binary"
	"net"
	"testing"
)

func TestExpandIPs(t *testing.T) {
	cases := []struct {
		spec string
		want int
		errs bool
	}{
		{"1.2.3.4", 1, false},
		{"1.2.3.4-1.2.3.8", 5, false},
		{"1.2.3.0/30", 4, false},
		{"1.2.3.8-1.2.3.4", 0, true},
		{"10.0.0.0/8", 0, true},
		{"1.0.0.0-1.2.0.0", 0, true},
		{"not-an-ip", 0, true},
	}
	for _, c := range cases {
		got, err := expandIPs(c.spec)
		if c.errs {
			if err == nil {
				t.Errorf("expandIPs(%q): expected error, got %v", c.spec, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("expandIPs(%q): %v", c.spec, err)
			continue
		}
		if len(got) != c.want {
			t.Errorf("expandIPs(%q): got %d addrs, want %d", c.spec, len(got), c.want)
		}
	}
}

func TestBuildSpoofedUDPWellFormed(t *testing.T) {
	src := net.ParseIP("8.8.8.8")
	dst := net.ParseIP("1.1.1.1")
	payload := buildProbePayload(src, 42, 5)
	pkt, err := buildSpoofedUDP(src, dst, 40000, 443, payload)
	if err != nil {
		t.Fatal(err)
	}

	// Re-summing a header that already carries its checksum yields 0.
	if s := onesComplementSum(pkt[0:20]); s != 0 {
		t.Errorf("IP header checksum invalid: re-sum = %#x, want 0", s)
	}

	// Source field really is the forged address, not the host's.
	if got := net.IP(pkt[12:16]).String(); got != "8.8.8.8" {
		t.Errorf("source IP = %s, want 8.8.8.8", got)
	}
	if got := net.IP(pkt[16:20]).String(); got != "1.1.1.1" {
		t.Errorf("dest IP = %s, want 1.1.1.1", got)
	}

	// UDP total length field matches header+payload.
	if l := binary.BigEndian.Uint16(pkt[24:26]); int(l) != 8+len(payload) {
		t.Errorf("UDP length = %d, want %d", l, 8+len(payload))
	}

	// The payload round-trips through the parser.
	claimed, seq, sent, ok := parseProbePayload(pkt[28:])
	if !ok || claimed.String() != "8.8.8.8" || seq != 42 || sent != 5 {
		t.Errorf("parseProbePayload = (%v, %d, %d, %v), want (8.8.8.8, 42, 5, true)", claimed, seq, sent, ok)
	}
}

func TestParseProbePayloadOldSender(t *testing.T) {
	// A 12-byte probe from a sender without the per-source count still parses.
	p := buildProbePayload(net.ParseIP("1.2.3.4"), 7, 3)[:spoofPayloadMinLen]
	claimed, seq, sent, ok := parseProbePayload(p)
	if !ok || claimed.String() != "1.2.3.4" || seq != 7 || sent != 0 {
		t.Errorf("parseProbePayload(old) = (%v, %d, %d, %v)", claimed, seq, sent, ok)
	}
}

func TestProbePacketsRoundTrip(t *testing.T) {
	src, dst := net.ParseIP("5.6.7.8"), net.ParseIP("1.1.1.1")
	for _, proto := range []string{probeICMP, probeTCP} {
		payload := buildProbePayload(src, 9, 4)
		pkt, err := buildProbePacket(proto, src, dst, 40000, 443, 9, payload)
		if err != nil {
			t.Fatalf("%s: %v", proto, err)
		}
		got := rawProbePayload(proto, 443, pkt)
		claimed, seq, sent, ok := parseProbePayload(got)
		if !ok || claimed.String() != "5.6.7.8" || seq != 9 || sent != 4 {
			t.Errorf("%s round trip = (%v, %d, %d, %v)", proto, claimed, seq, sent, ok)
		}
	}
	// A TCP probe to another port isn't ours.
	pkt, _ := buildProbePacket(probeTCP, src, dst, 40000, 8443, 1, buildProbePayload(src, 1, 1))
	if rawProbePayload(probeTCP, 443, pkt) != nil {
		t.Error("tcp probe to another port was accepted")
	}
}

func TestProbeStatLoss(t *testing.T) {
	cases := []struct {
		s    probeStat
		want float64
	}{
		{probeStat{got: 3, sent: 3}, 0},
		{probeStat{got: 1, sent: 4}, 75},
		{probeStat{got: 5, sent: 4}, 0}, // duplicates never go negative
		{probeStat{got: 2, sent: 0}, -1},
	}
	for _, c := range cases {
		if got := c.s.loss(); got != c.want {
			t.Errorf("%+v.loss() = %v, want %v", c.s, got, c.want)
		}
	}
}
