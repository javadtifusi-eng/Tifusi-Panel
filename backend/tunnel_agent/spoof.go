package main

// spoof is a real transport (not the spooftest probe): it carries the tunnel
// over source-spoofed UDP so it keeps working during Iran's national-internet
// mode, when L3 filtering only lets packets pass if their SOURCE IP is on the
// allow-list.
//
// The trick that makes it bidirectional — and dodges the broken-return-path
// problem — is that BOTH sides send with a forged source to the OTHER side's
// REAL IP. Neither side ever relies on a reply coming back to the forged
// address: each direction is an independent one-way send to a real
// destination, so the kernel on the receiving end delivers it normally. The
// forged source exists only to satisfy the egress filter.
//
// On the wire this is plain UDP, so the reliability/ordering the tunnel needs
// is provided by the same KCP layer the "udp" transport already uses. spoof
// just swaps KCP's underlying net.PacketConn for spoofPacketConn: reads come
// from a normal bound UDP socket, writes go out the raw IP_HDRINCL socket with
// the configured forged source.
//
// This is point-to-point (one Iran side ↔ one foreign side). Because incoming
// packets carry a forged (garbage) source, the receiver cannot demultiplex by
// source address, so spoofPacketConn reports every packet as coming from the
// one configured peer. That gives KCP a single, stable peer to talk to.

import (
	"fmt"
	"net"
	"sync"
	"time"

	kcp "github.com/xtaci/kcp-go/v5"
)

// spoofPacketConn is a net.PacketConn whose reads come from a plain UDP socket
// and whose writes leave through a raw socket with a forged source IP, aimed
// at the peer's real address. It is deliberately point-to-point: ReadFrom
// always reports the configured peer, so a forged inbound source can never
// confuse the KCP session above it.
type spoofPacketConn struct {
	rx      *net.UDPConn // plain listener: receives packets sent to our real IP
	sender  *spoofSender // raw socket: sends with a forged source
	spoofIP net.IP       // forged source IP stamped on every outbound packet
	peer    *net.UDPAddr // the other side's REAL ip:port (KCP's stable peer)
	sport   uint16       // UDP source port stamped on outbound packets

	closeOnce sync.Once
}

// newSpoofPacketConn binds a UDP listener on listenAddr (our real address) and
// opens the raw sender. spoofIP is the forged source; peer is the other side's
// real ip:port that outbound packets are aimed at.
func newSpoofPacketConn(listenAddr string, spoofIP net.IP, peer *net.UDPAddr) (*spoofPacketConn, error) {
	la, err := net.ResolveUDPAddr("udp4", listenAddr)
	if err != nil {
		return nil, fmt.Errorf("spoof: resolve listen %q: %w", listenAddr, err)
	}
	rx, err := net.ListenUDP("udp4", la)
	if err != nil {
		return nil, fmt.Errorf("spoof: listen udp %s: %w", listenAddr, err)
	}
	sender, err := newSpoofSender()
	if err != nil {
		rx.Close()
		return nil, err
	}
	sport := uint16(la.Port)
	if sport == 0 {
		if a, ok := rx.LocalAddr().(*net.UDPAddr); ok {
			sport = uint16(a.Port)
		}
	}
	return &spoofPacketConn{
		rx:      rx,
		sender:  sender,
		spoofIP: spoofIP.To4(),
		peer:    peer,
		sport:   sport,
	}, nil
}

// ReadFrom returns the payload of the next inbound packet, always attributed
// to the configured peer regardless of the forged source the kernel saw.
func (c *spoofPacketConn) ReadFrom(p []byte) (int, net.Addr, error) {
	n, _, err := c.rx.ReadFromUDP(p)
	if err != nil {
		return n, nil, err
	}
	return n, c.peer, nil
}

// WriteTo sends p to the peer's real IP with the forged source. The addr
// argument is ignored: this conn only ever talks to its one configured peer,
// which is what KCP hands back after ReadFrom.
func (c *spoofPacketConn) WriteTo(p []byte, _ net.Addr) (int, error) {
	if err := c.sender.send(c.spoofIP, c.peer.IP, c.sport, uint16(c.peer.Port), p); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (c *spoofPacketConn) Close() error {
	c.closeOnce.Do(func() {
		c.sender.close()
		c.rx.Close()
	})
	return nil
}

func (c *spoofPacketConn) LocalAddr() net.Addr                { return c.rx.LocalAddr() }
func (c *spoofPacketConn) SetDeadline(t time.Time) error      { return c.rx.SetDeadline(t) }
func (c *spoofPacketConn) SetReadDeadline(t time.Time) error  { return c.rx.SetReadDeadline(t) }
func (c *spoofPacketConn) SetWriteDeadline(t time.Time) error { return c.rx.SetWriteDeadline(t) }

// spoofListen is the server (Iran) side: it wraps a spoof packet conn in a KCP
// listener so the rest of the tunnel treats it exactly like the "udp"
// transport.
func spoofListen(listenAddr string, spoofIP net.IP, peer *net.UDPAddr) (net.Listener, error) {
	pc, err := newSpoofPacketConn(listenAddr, spoofIP, peer)
	if err != nil {
		return nil, err
	}
	ln, err := kcp.ServeConn(nil, 0, 0, pc)
	if err != nil {
		pc.Close()
		return nil, err
	}
	return ln, nil
}

// spoofDial is the client (foreign) side: it wraps a spoof packet conn in a
// single KCP session aimed at the peer.
func spoofDial(listenAddr string, spoofIP net.IP, peer *net.UDPAddr) (*kcp.UDPSession, error) {
	pc, err := newSpoofPacketConn(listenAddr, spoofIP, peer)
	if err != nil {
		return nil, err
	}
	sess, err := kcp.NewConn2(peer, nil, 0, 0, pc)
	if err != nil {
		pc.Close()
		return nil, err
	}
	return sess, nil
}
