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
	"strings"
	"sync"
	"sync/atomic"
	"time"

	kcp "github.com/xtaci/kcp-go/v5"
)

// spoofPacketConn is a net.PacketConn whose reads and writes are delegated to a
// pluggable carrier (see carrier.go): reads come from the carrier's receive
// socket, writes leave through a shared raw socket with a forged source IP
// aimed at the peer's real address. It is deliberately point-to-point: ReadFrom
// always reports the configured peer, so a forged inbound source can never
// confuse the KCP session above it.
type spoofPacketConn struct {
	car      spoofCarrier // frames outbound and reads inbound payloads per carrier
	sender   *spoofSender // raw socket: sends with a forged source
	spoofIPs []net.IP     // forged source pool; rotated per packet
	rr       uint32       // round-robin cursor over spoofIPs
	peer     *net.UDPAddr // the other side's REAL ip:port (KCP's stable peer)

	closeOnce sync.Once
}

// newSpoofPacketConn opens the receive side for the named carrier on listenAddr
// (our real address) and the raw sender. spoofIPs is the forged-source pool;
// peer is the other side's real ip:port that outbound packets are aimed at. An
// empty carrier name defaults to plain source-spoofed UDP.
func newSpoofPacketConn(listenAddr, carrier string, spoofIPs []net.IP, peer *net.UDPAddr) (*spoofPacketConn, error) {
	if len(spoofIPs) == 0 {
		return nil, errNoSpoofSources
	}
	car, err := newSpoofCarrier(carrier, listenAddr, peer)
	if err != nil {
		return nil, err
	}
	sender, err := newSpoofSender()
	if err != nil {
		car.close()
		return nil, err
	}
	pool := make([]net.IP, len(spoofIPs))
	for i, ip := range spoofIPs {
		pool[i] = ip.To4()
	}
	return &spoofPacketConn{
		car:      car,
		sender:   sender,
		spoofIPs: pool,
		peer:     peer,
	}, nil
}

// ReadFrom returns the payload of the next inbound packet, always attributed
// to the configured peer regardless of the forged source the kernel saw.
func (c *spoofPacketConn) ReadFrom(p []byte) (int, net.Addr, error) {
	n, err := c.car.readPayload(p)
	if err != nil {
		return n, nil, err
	}
	return n, c.peer, nil
}

// WriteTo sends p to the peer's real IP with the forged source, framed by the
// active carrier. The addr argument is ignored: this conn only ever talks to
// its one configured peer, which is what KCP hands back after ReadFrom.
func (c *spoofPacketConn) WriteTo(p []byte, _ net.Addr) (int, error) {
	// Rotate the forged source across the pool so a single address the filter
	// later drops does not take the whole tunnel down with it.
	src := c.spoofIPs[0]
	if len(c.spoofIPs) > 1 {
		n := atomic.AddUint32(&c.rr, 1)
		src = c.spoofIPs[int(n)%len(c.spoofIPs)]
	}
	pkt, err := c.car.frame(src, p)
	if err != nil {
		return 0, err
	}
	if err := c.sender.sendPacket(pkt, c.peer.IP); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (c *spoofPacketConn) Close() error {
	c.closeOnce.Do(func() {
		c.sender.close()
		c.car.close()
	})
	return nil
}

func (c *spoofPacketConn) LocalAddr() net.Addr               { return c.car.localAddr() }
func (c *spoofPacketConn) SetReadDeadline(t time.Time) error { return c.car.setReadDeadline(t) }

// SetDeadline applies to the read side; SetWriteDeadline is a no-op because
// writes go out through the raw sender's blocking Sendto, which has no
// deadline, and KCP only ever sets read deadlines on this conn.
func (c *spoofPacketConn) SetDeadline(t time.Time) error      { return c.car.setReadDeadline(t) }
func (c *spoofPacketConn) SetWriteDeadline(t time.Time) error { return nil }

// spoofListen is the server (Iran) side: it wraps a spoof packet conn in a KCP
// listener so the rest of the tunnel treats it exactly like the "udp"
// transport.
func spoofListen(listenAddr, carrier string, spoofIPs []net.IP, peer *net.UDPAddr, token string, fecData, fecParity int) (net.Listener, error) {
	pc, err := newSpoofPacketConn(listenAddr, carrier, spoofIPs, peer)
	if err != nil {
		return nil, err
	}
	obf, err := newObfPacketConn(pc, token)
	if err != nil {
		pc.Close()
		return nil, err
	}
	// AEAD already encrypts and authenticates, so KCP's own crypto slot stays
	// nil; FEC is still applied for loss resilience under throttling.
	ln, err := kcp.ServeConn(nil, fecData, fecParity, obf)
	if err != nil {
		obf.Close()
		return nil, err
	}
	return ln, nil
}

// spoofDial is the client (foreign) side: it wraps a spoof packet conn in a
// single KCP session aimed at the peer.
func spoofDial(listenAddr, carrier string, spoofIPs []net.IP, peer *net.UDPAddr, token string, fecData, fecParity int) (*kcp.UDPSession, error) {
	pc, err := newSpoofPacketConn(listenAddr, carrier, spoofIPs, peer)
	if err != nil {
		return nil, err
	}
	obf, err := newObfPacketConn(pc, token)
	if err != nil {
		pc.Close()
		return nil, err
	}
	// ownConn=true: closing the session must also close the spoof conn, or a
	// reconnect finds the port still bound (udp) or leaks raw sockets and
	// the RST-drop rule (tcp).
	sess, err := kcp.NewConn4(randU32(), peer, nil, fecData, fecParity, true, obf)
	if err != nil {
		obf.Close()
		return nil, err
	}
	return sess, nil
}

// parseSpoofSources expands "spoof_source" into the forged-source pool. It
// accepts a comma- or space-separated mix of single IPs, ranges (a-b) and
// CIDRs, reusing the same expander the spooftest command uses, and caps the
// pool so a huge CIDR can never balloon memory.
func parseSpoofSources(spec string) ([]net.IP, error) {
	const maxPool = 256
	var out []net.IP
	seen := map[string]bool{}
	for _, part := range strings.FieldsFunc(spec, func(r rune) bool { return r == ',' || r == ' ' || r == '\t' }) {
		ips, err := expandIPs(part)
		if err != nil {
			return nil, err
		}
		for _, ip := range ips {
			key := ip.String()
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, ip)
			if len(out) > maxPool {
				return nil, fmt.Errorf("spoof source pool exceeds %d addresses", maxPool)
			}
		}
	}
	if len(out) == 0 {
		return nil, errNoSpoofSources
	}
	return out, nil
}
