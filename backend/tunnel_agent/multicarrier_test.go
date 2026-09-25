package main

import (
	"net"
	"testing"
	"time"
)

// fakeCarrier is a spoofCarrier that records what it framed and feeds
// pre-seeded payloads, so the auto-mode plumbing can be tested without any
// raw sockets or network namespaces.
type fakeCarrier struct {
	name   string
	framed int
	in     chan []byte
}

func (f *fakeCarrier) readPayload(p []byte) (int, error) {
	b := <-f.in
	return copy(p, b), nil
}
func (f *fakeCarrier) frame(_ net.IP, payload []byte) ([]byte, error) {
	f.framed++
	// Prefix with the carrier name so the test can see which one framed it.
	return append([]byte(f.name+"|"), payload...), nil
}
func (f *fakeCarrier) setReadDeadline(time.Time) error { return nil }
func (f *fakeCarrier) localAddr() net.Addr             { return &net.UDPAddr{} }
func (f *fakeCarrier) close() error                    { return nil }

func TestClientSpoofCarrierRotation(t *testing.T) {
	c := &Client{cfg: &Config{Transport: "spoof", SpoofCarrier: carrierAuto}}
	want := []string{carrierUDP, carrierICMP, carrierTCP, carrierUDP, carrierICMP}
	for i, w := range want {
		if got := c.spoofCarrier(); got != w {
			t.Fatalf("attempt %d: carrier = %q, want %q", i, got, w)
		}
		c.advanceSpoofCarrier()
	}

	// A fixed carrier never rotates.
	fixed := &Client{cfg: &Config{Transport: "spoof", SpoofCarrier: carrierICMP}}
	for i := 0; i < 3; i++ {
		if got := fixed.spoofCarrier(); got != carrierICMP {
			t.Fatalf("fixed carrier drifted to %q", got)
		}
		fixed.advanceSpoofCarrier()
	}
}

func TestValidCarrierAndMTUForAuto(t *testing.T) {
	if !validSpoofCarrier(carrierAuto) {
		t.Error("auto should be a valid carrier")
	}
	// auto must reserve the same headroom as TCP, the widest-header carrier it
	// may land on, so a packet fits whichever carrier frames it.
	if carrierMTU(carrierAuto) != carrierMTU(carrierTCP) {
		t.Errorf("carrierMTU(auto)=%d, want it to equal tcp's %d", carrierMTU(carrierAuto), carrierMTU(carrierTCP))
	}
}

func TestMultiCarrierMirrorsLastInbound(t *testing.T) {
	udp := &fakeCarrier{name: "udp", in: make(chan []byte, 1)}
	icmp := &fakeCarrier{name: "icmp", in: make(chan []byte, 1)}
	tcp := &fakeCarrier{name: "tcp", in: make(chan []byte, 1)}
	m := &multiCarrierConn{
		carriers: []spoofCarrier{udp, icmp, tcp},
		spoofIPs: []net.IP{net.IPv4(10, 0, 0, 1).To4()},
		peer:     &net.UDPAddr{IP: net.IPv4(1, 2, 3, 4), Port: 8443},
		ch:       make(chan mcInbound, 4),
		closed:   make(chan struct{}),
	}
	m.sender = &spoofSender{fd: -1} // never sent to; frame is checked before send

	// Simulate an inbound packet that arrived on the ICMP carrier.
	m.ch <- mcInbound{payload: []byte("hi"), carrier: 1}
	buf := make([]byte, 64)
	n, _, err := m.ReadFrom(buf)
	if err != nil || string(buf[:n]) != "hi" {
		t.Fatalf("ReadFrom = %q, %v", buf[:n], err)
	}

	// WriteTo must frame the reply with the carrier the last inbound packet
	// used (ICMP here). The raw send fails (fd -1) after framing, which is
	// fine: we only care which carrier framed it.
	m.WriteTo([]byte("reply"), nil)
	if icmp.framed != 1 || udp.framed != 0 || tcp.framed != 0 {
		t.Fatalf("reply should mirror the icmp inbound; udp=%d icmp=%d tcp=%d", udp.framed, icmp.framed, tcp.framed)
	}

	// A later packet on the TCP carrier must move replies onto TCP.
	m.ch <- mcInbound{payload: []byte("x"), carrier: 2}
	m.ReadFrom(buf)
	m.WriteTo([]byte("reply2"), nil)
	if tcp.framed != 1 {
		t.Fatalf("reply should have moved to tcp; tcp framed=%d", tcp.framed)
	}
}
