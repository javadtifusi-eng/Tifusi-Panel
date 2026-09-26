package main

// multicarrier.go implements spoof_carrier "auto": the tunnel finds a carrier
// that works on the current path by itself and moves to another one when it
// stops working, so nobody has to switch UDP/ICMP/TCP by hand when an
// operator starts throttling one of them.
//
// The two sides split the job:
//
//   - The server (Iran side) listens on every carrier at once. Inbound
//     payloads from all of them are merged into one packet stream for KCP,
//     and every reply is framed with the carrier the most recent inbound
//     packet arrived on. The server never guesses: it mirrors the client.
//
//   - The client (foreign side) dials one carrier at a time, in the order of
//     autoCarriers. If a link cannot be established, or dies soon after it
//     came up, the next dial uses the next carrier. A link that stayed up for
//     a while is redialed on the same carrier, so a brief outage does not
//     push a working tunnel off a good carrier.

import (
	"errors"
	"log"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"time"

	kcp "github.com/xtaci/kcp-go/v5"
)

// carrierAuto is the spoof_carrier value that turns on automatic failover.
const carrierAuto = "auto"

// autoCarriers is the order the client cycles through in auto mode: UDP first
// (lowest overhead, works nearly everywhere), then ICMP, then TCP (the most
// likely to survive aggressive throttling because it looks like a normal
// connection). The server listens on all of these at once.
var autoCarriers = []string{carrierUDP, carrierICMP, carrierTCP}

// mcInbound is one payload read off one of the merged carriers, tagged with
// the carrier index so the server can reply on the same one.
type mcInbound struct {
	payload []byte
	carrier int
}

// multiCarrierConn is the server-side net.PacketConn for auto mode. It reads
// from every carrier's receive socket at once and writes each reply with the
// carrier the last inbound packet used.
type multiCarrierConn struct {
	carriers []spoofCarrier // one per autoCarriers entry, same index
	sender   *spoofSender   // shared raw sender for all carriers
	spoofIPs []net.IP       // forged source pool; rotated per packet
	rr       uint32         // round-robin cursor over spoofIPs
	peer     *net.UDPAddr   // KCP's single stable peer

	ch   chan mcInbound // fan-in of payloads from every carrier
	last int32          // index of the carrier the last inbound packet used

	deadline  atomic.Value // time.Time; zero means no deadline
	closeOnce sync.Once
	closed    chan struct{}
}

func newMultiCarrierConn(listenAddr string, spoofIPs []net.IP, peer *net.UDPAddr, opts *spoofOpts) (*multiCarrierConn, error) {
	if len(spoofIPs) == 0 {
		return nil, errNoSpoofSources
	}
	sender, err := newSpoofSender()
	if err != nil {
		return nil, err
	}
	pool := make([]net.IP, len(spoofIPs))
	for i, ip := range spoofIPs {
		pool[i] = ip.To4()
	}
	m := &multiCarrierConn{
		sender:   sender,
		spoofIPs: pool,
		peer:     peer,
		ch:       make(chan mcInbound, 256),
		closed:   make(chan struct{}),
	}
	// Open every carrier's receive side. A carrier that cannot open (for
	// example a kernel without raw ICMP) is skipped with a log line rather
	// than failing the whole tunnel, so the others still work.
	for _, name := range autoCarriers {
		car, err := newSpoofCarrier(name, listenAddr, peer, opts)
		if err != nil {
			log.Printf("spoof auto: carrier %s unavailable on this host, skipping: %v", name, err)
			continue
		}
		m.carriers = append(m.carriers, car)
	}
	if len(m.carriers) == 0 {
		sender.close()
		return nil, errors.New("spoof auto: no carrier could be opened")
	}
	for i, car := range m.carriers {
		go m.readLoop(i, car)
	}
	return m, nil
}

// readLoop pulls payloads off one carrier and feeds the shared channel,
// tagging each with the carrier index so replies can mirror it.
func (m *multiCarrierConn) readLoop(idx int, car spoofCarrier) {
	buf := make([]byte, 65535)
	for {
		n, err := car.readPayload(buf)
		if err != nil {
			select {
			case <-m.closed:
				return
			default:
				// A receive socket should not fail while open; if it does,
				// stop this carrier but leave the others running.
				return
			}
		}
		cp := make([]byte, n)
		copy(cp, buf[:n])
		select {
		case m.ch <- mcInbound{payload: cp, carrier: idx}:
		case <-m.closed:
			return
		}
	}
}

func (m *multiCarrierConn) ReadFrom(p []byte) (int, net.Addr, error) {
	var timer *time.Timer
	var timeout <-chan time.Time
	if d, ok := m.deadline.Load().(time.Time); ok && !d.IsZero() {
		delay := time.Until(d)
		if delay <= 0 {
			return 0, nil, os.ErrDeadlineExceeded
		}
		timer = time.NewTimer(delay)
		timeout = timer.C
		defer timer.Stop()
	}
	select {
	case in := <-m.ch:
		atomic.StoreInt32(&m.last, int32(in.carrier))
		return copy(p, in.payload), m.peer, nil
	case <-timeout:
		return 0, nil, os.ErrDeadlineExceeded
	case <-m.closed:
		return 0, nil, net.ErrClosed
	}
}

func (m *multiCarrierConn) WriteTo(p []byte, _ net.Addr) (int, error) {
	src := m.spoofIPs[0]
	if len(m.spoofIPs) > 1 {
		n := atomic.AddUint32(&m.rr, 1) - 1
		src = m.spoofIPs[int(n)%len(m.spoofIPs)]
	}
	car := m.carriers[int(atomic.LoadInt32(&m.last))]
	pkt, err := car.frame(src, p)
	if err != nil {
		return 0, err
	}
	if err := m.sender.sendPacket(pkt, m.peer.IP); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (m *multiCarrierConn) Close() error {
	m.closeOnce.Do(func() {
		close(m.closed)
		m.sender.close()
		for _, car := range m.carriers {
			car.close()
		}
	})
	return nil
}

func (m *multiCarrierConn) LocalAddr() net.Addr { return m.carriers[0].localAddr() }

func (m *multiCarrierConn) SetReadDeadline(t time.Time) error {
	m.deadline.Store(t)
	return nil
}
func (m *multiCarrierConn) SetDeadline(t time.Time) error      { return m.SetReadDeadline(t) }
func (m *multiCarrierConn) SetWriteDeadline(t time.Time) error { return nil }

// spoofListenAuto is the server side of auto mode: a KCP listener over the
// multi-carrier packet conn, matching spoofListen's shape exactly.
func spoofListenAuto(listenAddr string, spoofIPs []net.IP, peer *net.UDPAddr, token string, fecData, fecParity int, opts *spoofOpts) (net.Listener, error) {
	pc, err := newMultiCarrierConn(listenAddr, spoofIPs, peer, opts)
	if err != nil {
		return nil, err
	}
	obf, err := newObfPacketConn(pc, token)
	if err != nil {
		pc.Close()
		return nil, err
	}
	ln, err := kcp.ServeConn(nil, fecData, fecParity, obf)
	if err != nil {
		obf.Close()
		return nil, err
	}
	return ln, nil
}
