package main

import (
	"bytes"
	"net"
	"testing"
	"time"
)

// obfRoundTrip proves the AEAD wrapper encrypts and decrypts back to the exact
// payload over a real UDP hop, across a range of sizes (so the random padding
// is exercised), and that a mismatched token yields nothing (the packet is
// dropped rather than delivered as garbage).
func TestObfPacketConnRoundTrip(t *testing.T) {
	a, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()

	oa, err := newObfPacketConn(a, "shared-token-123")
	if err != nil {
		t.Fatal(err)
	}
	ob, err := newObfPacketConn(b, "shared-token-123")
	if err != nil {
		t.Fatal(err)
	}

	for _, size := range []int{0, 1, 100, 1200} {
		msg := bytes.Repeat([]byte{byte(size)}, size)
		if _, err := oa.WriteTo(msg, b.LocalAddr()); err != nil {
			t.Fatalf("write %d: %v", size, err)
		}
		buf := make([]byte, 65535)
		ob.SetReadDeadline(time.Now().Add(2 * time.Second))
		n, _, err := ob.ReadFrom(buf)
		if err != nil {
			t.Fatalf("read %d: %v", size, err)
		}
		if !bytes.Equal(buf[:n], msg) {
			t.Fatalf("size %d: payload mismatch (got %d bytes)", size, n)
		}
	}

	// A wrong token must not decrypt: the packet is silently dropped.
	oc, err := newObfPacketConn(a, "a-different-token")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := oc.WriteTo([]byte("hello"), b.LocalAddr()); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 65535)
	ob.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := ob.ReadFrom(buf); err == nil {
		t.Fatal("expected no delivery for a wrong-token packet, but one arrived")
	}
}

func TestParseSpoofSources(t *testing.T) {
	cases := []struct {
		spec string
		want int
	}{
		{"1.2.3.4", 1},
		{"1.2.3.4, 1.2.3.5 1.2.3.6", 3},
		{"10.0.0.1-10.0.0.10", 10},
		{"192.168.1.0/30", 4},
		{"1.2.3.4, 1.2.3.4", 1}, // dedup
	}
	for _, c := range cases {
		got, err := parseSpoofSources(c.spec)
		if err != nil {
			t.Fatalf("%q: %v", c.spec, err)
		}
		if len(got) != c.want {
			t.Fatalf("%q: want %d addresses, got %d", c.spec, c.want, len(got))
		}
	}
	if _, err := parseSpoofSources(""); err == nil {
		t.Fatal("empty spec should error")
	}
	if _, err := parseSpoofSources("not-an-ip"); err == nil {
		t.Fatal("garbage spec should error")
	}
}
