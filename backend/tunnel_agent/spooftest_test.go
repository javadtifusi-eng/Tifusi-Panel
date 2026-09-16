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
	payload := buildProbePayload(src, 42)
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
	claimed, seq, ok := parseProbePayload(pkt[28:])
	if !ok || claimed.String() != "8.8.8.8" || seq != 42 {
		t.Errorf("parseProbePayload = (%v, %d, %v), want (8.8.8.8, 42, true)", claimed, seq, ok)
	}
}
