package main

// carrier.go is the pluggable "how do we put the tunnel on the wire" layer of
// the spoof transport. The spoof trick itself never changes: every packet
// leaves through the raw IP_HDRINCL socket with a forged source IP so it
// passes Iran's national-internet L3 egress filter, and both ends send to the
// other's REAL address so no reply ever has to come back to the forged one.
//
// What a carrier decides is the L4 protocol that forged packet pretends to be:
//
//   - udp  — plain source-spoofed UDP (the original behaviour). RX is a normal
//            bound UDP socket, so the kernel strips the headers for us.
//   - icmp — the payload rides inside ICMP Echo Reply packets. Many carriers
//            that rate-limit or drop UDP still pass ICMP, and an echo *reply*
//            (not request) never makes the receiving kernel generate traffic
//            of its own. RX is a raw ICMP socket.
//   - tcp  — the payload rides inside forged TCP segments flagged PSH|ACK, so
//            to a stateless middlebox the flow looks like an ordinary
//            established TCP connection rather than the UDP that DPI most
//            readily throttles. RX is a raw TCP socket; the kernel's stray
//            RSTs (aimed at the forged source anyway) are suppressed with an
//            iptables rule while the tunnel is up.
//
// The reliability, ordering, encryption and traffic-shape padding all sit
// ABOVE this layer (KCP + obfPacketConn), so a carrier only has to (a) frame a
// payload into one forged IPv4 packet and (b) pull the next inbound payload
// back out, stripped of its L3/L4 headers. Anything that isn't ours that slips
// through the coarse per-carrier filter is dropped by the AEAD one layer up,
// so the filtering here only needs to be good enough to keep noise down.

import (
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"
)

// Supported carriers for the spoof transport.
const (
	carrierUDP  = "udp"
	carrierICMP = "icmp"
	carrierTCP  = "tcp"
)

// icmpTunnelID tags our ICMP Echo packets so the raw socket, which sees every
// ICMP packet on the host (real pings included), can cheaply skip anything
// that isn't ours before the AEAD layer even looks at it.
const icmpTunnelID uint16 = 0xF5F1

var errIPv4Only = errors.New("spoof carrier only supports IPv4 addresses")

// validSpoofCarrier reports whether name is a carrier we implement. An empty
// name is treated as the udp default by the caller, so it is not accepted here.
func validSpoofCarrier(name string) bool {
	switch name {
	case carrierUDP, carrierICMP, carrierTCP:
		return true
	default:
		return false
	}
}

// carrierMTU is the KCP MTU to use for a given carrier so that after KCP's
// header, the AEAD nonce+tag+padding and the carrier's own L3/L4 headers the
// datagram still fits inside a 1500-byte path without fragmenting. TCP's header
// is 12 bytes larger than UDP's, so it gets a little less room.
func carrierMTU(name string) int {
	if name == carrierTCP {
		return 1180
	}
	return 1200
}

// spoofCarrier frames one tunnel payload into a forged IPv4 packet and reads
// the next inbound payload back out with its headers removed. Reads are
// serialised by the obf layer above, so implementations need no read locking.
type spoofCarrier interface {
	// readPayload blocks until one tunnel payload arrives (or the read
	// deadline fires), copies it into p and returns its length. Packets that
	// aren't ours are skipped internally.
	readPayload(p []byte) (int, error)
	// frame builds a complete forged IPv4 packet carrying payload, with source
	// src, aimed at the configured peer.
	frame(src net.IP, payload []byte) ([]byte, error)
	setReadDeadline(t time.Time) error
	localAddr() net.Addr
	close() error
}

// newSpoofCarrier opens the receive side for the named carrier and returns a
// carrier bound to peer. listenAddr is our real "host:port"; its port is used
// as the UDP source port / the TCP port both filtering and framing key on.
func newSpoofCarrier(name, listenAddr string, peer *net.UDPAddr) (spoofCarrier, error) {
	la, err := net.ResolveUDPAddr("udp4", listenAddr)
	if err != nil {
		return nil, fmt.Errorf("spoof: resolve listen %q: %w", listenAddr, err)
	}
	switch name {
	case "", carrierUDP:
		return newUDPCarrier(la, peer)
	case carrierICMP:
		return newICMPCarrier(uint16(la.Port), peer)
	case carrierTCP:
		return newTCPCarrier(uint16(la.Port), peer)
	default:
		return nil, fmt.Errorf("unknown spoof carrier %q", name)
	}
}

// ---------------------------------------------------------------- udp carrier

// udpCarrier keeps the original behaviour: RX is a plain bound UDP socket, so
// the kernel delivers the payload with the IP/UDP headers already stripped.
type udpCarrier struct {
	rx    *net.UDPConn
	sport uint16
	peer  *net.UDPAddr
}

func newUDPCarrier(la, peer *net.UDPAddr) (*udpCarrier, error) {
	rx, err := net.ListenUDP("udp4", la)
	if err != nil {
		return nil, fmt.Errorf("spoof: listen udp %s: %w", la, err)
	}
	sport := uint16(la.Port)
	if sport == 0 {
		if a, ok := rx.LocalAddr().(*net.UDPAddr); ok {
			sport = uint16(a.Port)
		}
	}
	return &udpCarrier{rx: rx, sport: sport, peer: peer}, nil
}

func (c *udpCarrier) readPayload(p []byte) (int, error) {
	n, _, err := c.rx.ReadFromUDP(p)
	return n, err
}

func (c *udpCarrier) frame(src net.IP, payload []byte) ([]byte, error) {
	return buildSpoofedUDP(src, c.peer.IP, c.sport, uint16(c.peer.Port), payload)
}

func (c *udpCarrier) setReadDeadline(t time.Time) error { return c.rx.SetReadDeadline(t) }
func (c *udpCarrier) localAddr() net.Addr               { return c.rx.LocalAddr() }
func (c *udpCarrier) close() error                      { return c.rx.Close() }

// ---------------------------------------------------------- raw receive helper

// openRawRecv opens a non-blocking raw receive socket for one IP protocol and
// wraps it in an *os.File so Go's netpoller gives us working read deadlines
// (which KCP relies on). The kernel still processes these packets normally in
// parallel; the raw socket only receives an extra copy.
func openRawRecv(proto int) (*os.File, error) {
	fd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_RAW, proto)
	if err != nil {
		return nil, fmt.Errorf("open raw recv socket (need root/CAP_NET_RAW): %w", err)
	}
	if err := syscall.SetNonblock(fd, true); err != nil {
		syscall.Close(fd)
		return nil, fmt.Errorf("set raw recv nonblocking: %w", err)
	}
	return os.NewFile(uintptr(fd), "spoof-raw-recv"), nil
}

// ipHeaderLen returns the IHL (header length in bytes) of an IPv4 packet, or 0
// if the buffer is too short to hold even a minimal header.
func ipHeaderLen(pkt []byte) int {
	if len(pkt) < 20 {
		return 0
	}
	return int(pkt[0]&0x0f) * 4
}

// --------------------------------------------------------------- icmp carrier

type icmpCarrier struct {
	rx   *os.File
	rbuf []byte
	id   uint16
	seq  uint32
	peer *net.UDPAddr
}

func newICMPCarrier(_ uint16, peer *net.UDPAddr) (*icmpCarrier, error) {
	rx, err := openRawRecv(syscall.IPPROTO_ICMP)
	if err != nil {
		return nil, err
	}
	return &icmpCarrier{rx: rx, rbuf: make([]byte, 65535), id: icmpTunnelID, peer: peer}, nil
}

func (c *icmpCarrier) readPayload(p []byte) (int, error) {
	for {
		n, err := c.rx.Read(c.rbuf)
		if err != nil {
			return 0, err
		}
		ihl := ipHeaderLen(c.rbuf[:n])
		if ihl == 0 || n < ihl+8 {
			continue
		}
		icmp := c.rbuf[ihl:n]
		// Echo Reply (type 0, code 0) carrying our tunnel id; skip everything
		// else, real pings and unrelated ICMP included.
		if icmp[0] != 0 || icmp[1] != 0 {
			continue
		}
		if binary.BigEndian.Uint16(icmp[4:6]) != c.id {
			continue
		}
		payload := icmp[8:]
		return copy(p, payload), nil
	}
}

func (c *icmpCarrier) frame(src net.IP, payload []byte) ([]byte, error) {
	seq := uint16(atomic.AddUint32(&c.seq, 1))
	return buildSpoofedICMP(src, c.peer.IP, c.id, seq, payload)
}

func (c *icmpCarrier) setReadDeadline(t time.Time) error { return c.rx.SetReadDeadline(t) }
func (c *icmpCarrier) localAddr() net.Addr               { return icmpAddr{} }
func (c *icmpCarrier) close() error                      { return c.rx.Close() }

// icmpAddr is a stand-in LocalAddr for the ICMP carrier, which has no port.
type icmpAddr struct{}

func (icmpAddr) Network() string { return "ip4:icmp" }
func (icmpAddr) String() string  { return "ip4:icmp" }

// ---------------------------------------------------------------- tcp carrier

type tcpCarrier struct {
	rx      *os.File
	rbuf    []byte
	port    uint16 // our port: inbound dst-port filter and outbound src port
	peer    *net.UDPAddr
	seq     uint32
	ack     uint32
	rstRule []string // installed iptables OUTPUT rule, for cleanup on close
}

func newTCPCarrier(port uint16, peer *net.UDPAddr) (*tcpCarrier, error) {
	rx, err := openRawRecv(syscall.IPPROTO_TCP)
	if err != nil {
		return nil, err
	}
	c := &tcpCarrier{
		rx:   rx,
		rbuf: make([]byte, 65535),
		port: port,
		peer: peer,
		seq:  randU32(),
		ack:  randU32(),
	}
	c.installRSTDrop()
	return c, nil
}

func (c *tcpCarrier) readPayload(p []byte) (int, error) {
	for {
		n, err := c.rx.Read(c.rbuf)
		if err != nil {
			return 0, err
		}
		ihl := ipHeaderLen(c.rbuf[:n])
		if ihl == 0 || n < ihl+20 {
			continue
		}
		tcp := c.rbuf[ihl:n]
		if binary.BigEndian.Uint16(tcp[2:4]) != c.port { // dst port must be ours
			continue
		}
		dataOff := int(tcp[12]>>4) * 4
		if dataOff < 20 || ihl+dataOff > n {
			continue
		}
		payload := c.rbuf[ihl+dataOff : n]
		if len(payload) == 0 { // bare ACK / handshake noise, nothing to carry
			continue
		}
		return copy(p, payload), nil
	}
}

func (c *tcpCarrier) frame(src net.IP, payload []byte) ([]byte, error) {
	// Advance the sequence number by the payload length so the stream's byte
	// counter looks consistent to a stateful observer.
	end := atomic.AddUint32(&c.seq, uint32(len(payload)))
	seq := end - uint32(len(payload))
	return buildSpoofedTCP(src, c.peer.IP, c.port, uint16(c.peer.Port), seq, atomic.LoadUint32(&c.ack), payload)
}

func (c *tcpCarrier) setReadDeadline(t time.Time) error { return c.rx.SetReadDeadline(t) }
func (c *tcpCarrier) localAddr() net.Addr               { return &net.TCPAddr{Port: int(c.port)} }

func (c *tcpCarrier) close() error {
	c.removeRSTDrop()
	return c.rx.Close()
}

// installRSTDrop stops the kernel leaking RST packets for our forged TCP flow.
// Every inbound forged segment reaches a port the kernel has no socket for, so
// it answers with an RST whose source is our real IP:port and whose
// destination is the forged (real, allow-listed) source. Those RSTs are noise
// aimed at an innocent address and a giveaway, so we drop them on the way out
// while the tunnel is up. It is best-effort: on a host without iptables the
// tunnel still works, just noisier, so a failure is logged, not fatal.
func (c *tcpCarrier) installRSTDrop() {
	rule := []string{"-p", "tcp", "--sport", strconv.Itoa(int(c.port)), "--tcp-flags", "RST", "RST", "-j", "DROP"}
	if out, err := exec.Command("iptables", append([]string{"-I", "OUTPUT"}, rule...)...).CombinedOutput(); err != nil {
		log.Printf("spoof tcp carrier: could not install RST-drop rule (kernel RSTs will leak to the forged source): %v: %s", err, out)
		return
	}
	c.rstRule = rule
}

func (c *tcpCarrier) removeRSTDrop() {
	if c.rstRule == nil {
		return
	}
	if out, err := exec.Command("iptables", append([]string{"-D", "OUTPUT"}, c.rstRule...)...).CombinedOutput(); err != nil {
		log.Printf("spoof tcp carrier: could not remove RST-drop rule (clean it up by hand): %v: %s", err, out)
	}
	c.rstRule = nil
}

func randU32() uint32 {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return uint32(time.Now().UnixNano())
	}
	return binary.BigEndian.Uint32(b[:])
}

// -------------------------------------------------------------- packet builders

// buildSpoofedICMP assembles a forged-source IPv4 packet whose ICMP body is an
// Echo Reply (type 0) carrying payload after the 8-byte ICMP header.
func buildSpoofedICMP(srcIP, dstIP net.IP, id, seq uint16, payload []byte) ([]byte, error) {
	src, dst := srcIP.To4(), dstIP.To4()
	if src == nil || dst == nil {
		return nil, errIPv4Only
	}
	const ipHdrLen, icmpHdrLen = 20, 8
	total := ipHdrLen + icmpHdrLen + len(payload)
	pkt := make([]byte, total)

	pkt[0] = 0x45
	binary.BigEndian.PutUint16(pkt[2:4], uint16(total))
	pkt[8] = 64
	pkt[9] = syscall.IPPROTO_ICMP
	copy(pkt[12:16], src)
	copy(pkt[16:20], dst)
	binary.BigEndian.PutUint16(pkt[10:12], onesComplementSum(pkt[0:ipHdrLen]))

	icmp := pkt[ipHdrLen:]
	icmp[0] = 0 // type: Echo Reply
	icmp[1] = 0 // code
	binary.BigEndian.PutUint16(icmp[4:6], id)
	binary.BigEndian.PutUint16(icmp[6:8], seq)
	copy(icmp[icmpHdrLen:], payload)
	// ICMP checksum covers the ICMP header and payload only (no pseudo-header).
	binary.BigEndian.PutUint16(icmp[2:4], onesComplementSum(icmp[:icmpHdrLen+len(payload)]))

	return pkt, nil
}

// buildSpoofedTCP assembles a forged-source IPv4 packet whose TCP body is a
// PSH|ACK segment carrying payload. seq/ack are stamped so the flow reads like
// an established connection; there is no handshake because the far side reads
// with a raw socket, not the kernel TCP stack.
func buildSpoofedTCP(srcIP, dstIP net.IP, srcPort, dstPort uint16, seq, ack uint32, payload []byte) ([]byte, error) {
	src, dst := srcIP.To4(), dstIP.To4()
	if src == nil || dst == nil {
		return nil, errIPv4Only
	}
	const ipHdrLen, tcpHdrLen = 20, 20
	total := ipHdrLen + tcpHdrLen + len(payload)
	pkt := make([]byte, total)

	pkt[0] = 0x45
	binary.BigEndian.PutUint16(pkt[2:4], uint16(total))
	pkt[8] = 64
	pkt[9] = syscall.IPPROTO_TCP
	copy(pkt[12:16], src)
	copy(pkt[16:20], dst)
	binary.BigEndian.PutUint16(pkt[10:12], onesComplementSum(pkt[0:ipHdrLen]))

	tcp := pkt[ipHdrLen:]
	binary.BigEndian.PutUint16(tcp[0:2], srcPort)
	binary.BigEndian.PutUint16(tcp[2:4], dstPort)
	binary.BigEndian.PutUint32(tcp[4:8], seq)
	binary.BigEndian.PutUint32(tcp[8:12], ack)
	tcp[12] = 5 << 4 // data offset: 5 32-bit words, no options
	tcp[13] = 0x18   // flags: PSH | ACK
	binary.BigEndian.PutUint16(tcp[14:16], 0xffff)
	copy(tcp[tcpHdrLen:], payload)

	// TCP checksum covers a pseudo-header (src, dst, proto, tcp length) plus
	// the TCP header and payload.
	pseudo := make([]byte, 12+tcpHdrLen+len(payload))
	copy(pseudo[0:4], src)
	copy(pseudo[4:8], dst)
	pseudo[9] = syscall.IPPROTO_TCP
	binary.BigEndian.PutUint16(pseudo[10:12], uint16(tcpHdrLen+len(payload)))
	copy(pseudo[12:], tcp[:tcpHdrLen+len(payload)])
	binary.BigEndian.PutUint16(tcp[16:18], onesComplementSum(pseudo))

	return pkt, nil
}
