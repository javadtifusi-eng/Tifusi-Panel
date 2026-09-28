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
//   - icmpv6 — like icmp, but the IPv4 packet claims protocol 58 and carries an
//            ICMPv6 Echo Reply. A firewall that shuts IPv6 down often leaves
//            ICMPv6 itself alone, and a rule written for ICMP (protocol 1)
//            doesn't match it. RX is a raw protocol-58 socket.
//   - tcp  — the payload rides inside forged TCP segments flagged PSH|ACK, so
//            to a stateless middlebox the flow looks like an ordinary
//            established TCP connection rather than the UDP that DPI most
//            readily throttles. RX is a raw TCP socket; the kernel's stray
//            RSTs (aimed at the forged source anyway) are suppressed with an
//            iptables rule while the tunnel is up.
//
// The kernel's firewall sees our packets too, and to conntrack an Echo Reply
// with no request or a mid-stream TCP segment with no handshake is INVALID,
// which ufw and most hardened rulesets drop before a raw socket ever gets a
// copy. So each raw carrier exempts its own traffic from conntrack and accepts
// it in INPUT for as long as it is open (see fwRule).
//
// Each direction can use its own carrier: "tcp>icmpv6" sends on tcp and
// receives on icmpv6, and the far side is configured the other way round.
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
	mrand "math/rand"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// Supported carriers for the spoof transport.
const (
	carrierUDP    = "udp"
	carrierICMP   = "icmp"
	carrierICMPv6 = "icmpv6"
	carrierTCP    = "tcp"

	// carrierPairSep joins a send and a receive carrier into one name.
	carrierPairSep = ">"
)

// ipProtoICMPv6 is ICMPv6's IP protocol number, stamped in an IPv4 header.
const ipProtoICMPv6 = 58

// icmpTunnelID tags our ICMP Echo packets so the raw socket, which sees every
// ICMP packet on the host (real pings included), can cheaply skip anything
// that isn't ours before the AEAD layer even looks at it.
const icmpTunnelID uint16 = 0xF5F1

var errIPv4Only = errors.New("spoof carrier only supports IPv4 addresses")

// spoofOpts carries the optional hardening knobs shared by every carrier. A
// nil *spoofOpts means "all defaults, nothing extra", so callers that don't
// care can pass nil.
type spoofOpts struct {
	// stealth randomises the outbound packet's fingerprint: a TTL drawn from
	// common values, a random DSCP, and a random L4 source port. They are
	// drawn once per session (see session) and then held, because a real
	// flow keeps them constant and per-packet changes are a giveaway. It only
	// changes how our own packets look, so the peer needs no matching setting.
	stealth bool
	// peerSrcs, when set, are the forged source addresses inbound packets are
	// allowed to carry; anything else is dropped before the cipher sees it.
	// It mirrors the far side's spoof_source pool and tightens the filter.
	peerSrcs map[[4]byte]bool
	// icmpID tags our ICMP Echo packets. It is derived from the token so each
	// tunnel has its own instead of one constant every install shares. Zero
	// means icmpTunnelID.
	icmpID uint16

	// Per-session stealth values, filled in by session().
	ttl   byte
	tos   byte
	sport uint16
}

// stealthTTLs are the initial TTLs a fresh packet most commonly leaves a host
// with, so drawing from them looks like ordinary mixed traffic.
var stealthTTLs = [3]byte{64, 128, 255}

func (o *spoofOpts) on() bool { return o != nil && o.stealth }

// session returns a copy of o with the stealth values drawn once, for one
// carrier's lifetime. A reconnect opens a new carrier and so a new look.
func (o *spoofOpts) session() *spoofOpts {
	if o == nil {
		return nil
	}
	cp := *o
	if cp.stealth {
		var b [4]byte
		rand.Read(b[:])
		cp.ttl = stealthTTLs[int(b[0])%len(stealthTTLs)]
		cp.tos = b[1] & 0xFC // DSCP in the top 6 bits, ECN left 0
		cp.sport = 1024 + binary.BigEndian.Uint16(b[2:4])%64512
	}
	return &cp
}

// icmp returns the ICMP Echo id this tunnel uses.
func (o *spoofOpts) icmp() uint16 {
	if o == nil || o.icmpID == 0 {
		return icmpTunnelID
	}
	return o.icmpID
}

// srcPort returns the L4 source port to stamp: the session's random high port
// when stealth is on, otherwise the fixed default the carrier normally uses.
func (o *spoofOpts) srcPort(def uint16) uint16 {
	if !o.on() {
		return def
	}
	if o.sport != 0 {
		return o.sport
	}
	var b [2]byte
	if _, err := rand.Read(b[:]); err != nil {
		return def
	}
	// A high, ephemeral-range port (1024..65535).
	return 1024 + binary.BigEndian.Uint16(b[:])%64512
}

// decorate applies the IP-header-only stealth tweaks (TTL, DSCP) to an
// assembled packet and fixes the IP checksum. The L4 checksum is untouched
// because it does not cover these bytes.
func (o *spoofOpts) decorate(pkt []byte) {
	if !o.on() || len(pkt) < 20 {
		return
	}
	ttl, tos := o.ttl, o.tos
	if ttl == 0 {
		var b [2]byte
		rand.Read(b[:])
		ttl, tos = stealthTTLs[int(b[0])%len(stealthTTLs)], b[1]&0xFC
	}
	pkt[8] = ttl
	pkt[1] = tos
	binary.BigEndian.PutUint16(pkt[10:12], 0)
	binary.BigEndian.PutUint16(pkt[10:12], onesComplementSum(pkt[0:20]))
}

// allowSrc reports whether an inbound packet from forged source src passes the
// peer-source pin. With no pin configured every source is allowed.
func (o *spoofOpts) allowSrc(src net.IP) bool {
	if o == nil || len(o.peerSrcs) == 0 {
		return true
	}
	v4 := src.To4()
	if v4 == nil {
		return false
	}
	var k [4]byte
	copy(k[:], v4)
	return o.peerSrcs[k]
}

// newPeerSrcs turns a parsed source pool into the allowSrc lookup set.
func newPeerSrcs(ips []net.IP) map[[4]byte]bool {
	m := make(map[[4]byte]bool, len(ips))
	for _, ip := range ips {
		if v4 := ip.To4(); v4 != nil {
			var k [4]byte
			copy(k[:], v4)
			m[k] = true
		}
	}
	return m
}

// validSpoofCarrier reports whether name is a carrier we implement. An empty
// name is treated as the udp default by the caller, so it is not accepted here.
func validSpoofCarrier(name string) bool {
	switch name {
	case carrierUDP, carrierICMP, carrierICMPv6, carrierTCP, carrierAuto:
		return true
	default:
		return false
	}
}

// carrierMTU is the KCP MTU to use for a given carrier so that after KCP's
// header, the AEAD nonce+tag+padding and the carrier's own L3/L4 headers the
// datagram still fits inside a 1500-byte path without fragmenting. TCP's header
// with its timestamp option is 24 bytes larger than UDP's, so it gets less room.
func carrierMTU(name string) int {
	// auto may land on the TCP carrier, so it must use TCP's smaller budget
	// for every carrier — a fixed MTU that both ends agree on regardless of
	// which carrier a given packet rides. A split pair takes the smaller of
	// its two, so both ends agree on it too.
	tx, rx := splitCarrierPair(name)
	for _, c := range []string{tx, rx} {
		if c == carrierTCP || c == carrierAuto {
			return 1176
		}
	}
	return 1200
}

// splitCarrierPair splits "tx>rx" into its send and receive carriers; a plain
// name is both.
func splitCarrierPair(name string) (tx, rx string) {
	if i := strings.Index(name, carrierPairSep); i >= 0 {
		return name[:i], name[i+len(carrierPairSep):]
	}
	return name, name
}

// carrierPair is the name for sending on tx and receiving on rx.
func carrierPair(tx, rx string) string {
	if rx == "" || rx == tx {
		return tx
	}
	return tx + carrierPairSep + rx
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
func newSpoofCarrier(name, listenAddr string, peer *net.UDPAddr, opts *spoofOpts) (spoofCarrier, error) {
	la, err := net.ResolveUDPAddr("udp4", listenAddr)
	if err != nil {
		return nil, fmt.Errorf("spoof: resolve listen %q: %w", listenAddr, err)
	}
	opts = opts.session()
	if tx, rx := splitCarrierPair(name); tx != rx {
		return newSplitCarrier(tx, rx, la, peer, opts)
	}
	return openCarrier(name, la, peer, opts)
}

func openCarrier(name string, la, peer *net.UDPAddr, opts *spoofOpts) (spoofCarrier, error) {
	switch name {
	case "", carrierUDP:
		return newUDPCarrier(la, peer, opts)
	case carrierICMP:
		return newICMPCarrier(uint16(la.Port), peer, opts)
	case carrierICMPv6:
		return newICMPv6Carrier(peer, opts)
	case carrierTCP:
		return newTCPCarrier(uint16(la.Port), peer, opts)
	default:
		return nil, fmt.Errorf("unknown spoof carrier %q", name)
	}
}

// ------------------------------------------------------------- split carrier

// splitCarrier sends on one carrier and receives on another. The send side's
// own receive socket is closed straight away: framing needs none of it, and a
// raw socket nobody reads would still be handed a copy of every packet.
type splitCarrier struct {
	tx spoofCarrier
	rx spoofCarrier
}

func newSplitCarrier(tx, rx string, la, peer *net.UDPAddr, opts *spoofOpts) (spoofCarrier, error) {
	if tx == carrierAuto || rx == carrierAuto {
		return nil, errors.New("auto can't be one side of a split carrier")
	}
	rxCar, err := openCarrier(rx, la, peer, opts)
	if err != nil {
		return nil, err
	}
	// The send side never binds: a UDP one would clash with a UDP receive side
	// on the same port, and none of them reads anything here.
	txLA := &net.UDPAddr{IP: la.IP, Port: 0}
	if tx != carrierUDP {
		txLA = la // tcp stamps its port on outbound segments
	}
	txCar, err := openCarrier(tx, txLA, peer, opts)
	if err != nil {
		rxCar.close()
		return nil, err
	}
	if u, ok := txCar.(*udpCarrier); ok {
		u.sport = uint16(la.Port) // send from our real port, like a plain udp carrier
	}
	sendOnly(txCar)
	return &splitCarrier{tx: txCar, rx: rxCar}, nil
}

// sendOnly closes a carrier's receive side while keeping what sending still
// needs: the raw carriers' outbound conntrack exemption.
func sendOnly(c spoofCarrier) {
	var fw *[]fwRule
	switch c := c.(type) {
	case *icmpCarrier:
		c.rx.Close()
		fw = &c.fw
	case *tcpCarrier:
		c.rx.Close()
		fw = &c.fw
	default:
		c.close()
		return
	}
	var keep, drop []fwRule
	for _, r := range *fw {
		if r.table == "raw" && r.chain == "OUTPUT" {
			keep = append(keep, r)
		} else {
			drop = append(drop, r)
		}
	}
	removeFW("spoof carrier", drop)
	*fw = keep
}

func (c *splitCarrier) readPayload(p []byte) (int, error) { return c.rx.readPayload(p) }
func (c *splitCarrier) frame(src net.IP, payload []byte) ([]byte, error) {
	return c.tx.frame(src, payload)
}
func (c *splitCarrier) setReadDeadline(t time.Time) error { return c.rx.setReadDeadline(t) }
func (c *splitCarrier) localAddr() net.Addr               { return c.rx.localAddr() }
func (c *splitCarrier) close() error {
	c.tx.close() // only its outbound rules are left to remove
	return c.rx.close()
}

// ---------------------------------------------------------------- udp carrier

// udpCarrier keeps the original behaviour: RX is a plain bound UDP socket, so
// the kernel delivers the payload with the IP/UDP headers already stripped.
type udpCarrier struct {
	rx    *net.UDPConn
	sport uint16
	peer  *net.UDPAddr
	opts  *spoofOpts
}

func newUDPCarrier(la, peer *net.UDPAddr, opts *spoofOpts) (*udpCarrier, error) {
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
	return &udpCarrier{rx: rx, sport: sport, peer: peer, opts: opts}, nil
}

func (c *udpCarrier) readPayload(p []byte) (int, error) {
	for {
		n, from, err := c.rx.ReadFromUDP(p)
		if err != nil {
			return n, err
		}
		// The kernel reports the forged source on a plain UDP socket, so the
		// peer-source pin can be enforced here directly.
		if from != nil && !c.opts.allowSrc(from.IP.To4()) {
			continue
		}
		return n, nil
	}
}

func (c *udpCarrier) frame(src net.IP, payload []byte) ([]byte, error) {
	pkt, err := buildSpoofedUDP(src, c.peer.IP, c.opts.srcPort(c.sport), uint16(c.peer.Port), payload)
	if err != nil {
		return nil, err
	}
	c.opts.decorate(pkt)
	return pkt, nil
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
	rx       *os.File
	rbuf     []byte
	id       uint16
	seq      uint32
	peer     *net.UDPAddr
	opts     *spoofOpts
	proto    byte // IPPROTO_ICMP, or ipProtoICMPv6 for the icmpv6 carrier
	echoType byte // the Echo Reply type in that protocol: 0, or 129 for ICMPv6
	fw       []fwRule
}

func newICMPCarrier(_ uint16, peer *net.UDPAddr, opts *spoofOpts) (*icmpCarrier, error) {
	return newEchoCarrier(syscall.IPPROTO_ICMP, 0, peer, opts)
}

// newICMPv6Carrier carries the payload in ICMPv6 Echo Replies inside IPv4.
// No IPv4 handler exists for protocol 58, but the kernel hands such packets to
// a raw socket for it, and while one is open it sends no Protocol Unreachable.
func newICMPv6Carrier(peer *net.UDPAddr, opts *spoofOpts) (*icmpCarrier, error) {
	return newEchoCarrier(ipProtoICMPv6, 129, peer, opts)
}

func newEchoCarrier(proto, echoType byte, peer *net.UDPAddr, opts *spoofOpts) (*icmpCarrier, error) {
	rx, err := openRawRecv(int(proto))
	if err != nil {
		return nil, err
	}
	c := &icmpCarrier{rx: rx, rbuf: make([]byte, 65535), id: opts.icmp(), peer: peer, opts: opts, proto: proto, echoType: echoType}
	c.fw = installFW("spoof "+c.name()+" carrier", c.fwRules())
	return c, nil
}

func (c *icmpCarrier) name() string {
	if c.proto == ipProtoICMPv6 {
		return carrierICMPv6
	}
	return carrierICMP
}

// fwRules keeps conntrack away from our Echo Replies, which it would call
// INVALID for answering no request. Nothing else on an IPv4 host speaks
// protocol 58, so icmpv6 matches on that alone; icmp is narrowed to our Echo
// id where the u32 match exists (the id is the 16 bits after the checksum).
func (c *icmpCarrier) fwRules() []fwRule {
	match := []string{"-p", strconv.Itoa(ipProtoICMPv6)}
	if c.proto != ipProtoICMPv6 {
		match = []string{"-p", "icmp", "--icmp-type", "echo-reply"}
		if iptablesHasU32() {
			match = append(match, "-m", "u32", "--u32", fmt.Sprintf("0>>22&0x3C@4>>16=0x%04X", c.id))
		}
	}
	out := append([]string{"-d", c.peer.IP.String()}, match...)
	return passRules(match, out, c.opts.peerList())
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
		if !c.opts.allowSrc(net.IP(c.rbuf[12:16])) {
			continue
		}
		icmp := c.rbuf[ihl:n]
		// Echo Reply (code 0) carrying our tunnel id; skip everything else,
		// real pings and unrelated ICMP included.
		if icmp[0] != c.echoType || icmp[1] != 0 {
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
	pkt, err := buildSpoofedEcho(c.proto, c.echoType, src, c.peer.IP, c.id, seq, payload)
	if err != nil {
		return nil, err
	}
	c.opts.decorate(pkt)
	return pkt, nil
}

func (c *icmpCarrier) setReadDeadline(t time.Time) error { return c.rx.SetReadDeadline(t) }
func (c *icmpCarrier) localAddr() net.Addr               { return icmpAddr{} }

func (c *icmpCarrier) close() error {
	removeFW("spoof "+c.name()+" carrier", c.fw)
	c.fw = nil
	return c.rx.Close()
}

// icmpAddr is a stand-in LocalAddr for the ICMP carrier, which has no port.
type icmpAddr struct{}

func (icmpAddr) Network() string { return "ip4:icmp" }
func (icmpAddr) String() string  { return "ip4:icmp" }

// ---------------------------------------------------------------- tcp carrier

type tcpCarrier struct {
	rx    *os.File
	rbuf  []byte
	port  uint16 // our port: inbound dst-port filter and outbound src port
	peer  *net.UDPAddr
	opts  *spoofOpts
	start time.Time

	// Each forged source is its own "connection" to an observer, so each gets
	// its own sequence space, timestamps and IP ids; one counter shared across
	// the pool would make every flow's numbers jump around.
	mu    sync.Mutex
	flows map[[4]byte]*tcpFlow

	rcvd   uint32 // payload bytes received, which every flow's ack advances by
	peerTS uint32 // the last TSval the peer sent, echoed back as TSecr

	fw []fwRule
}

// tcpFlow is the per-forged-source state of the tcp carrier.
type tcpFlow struct {
	seq      uint32
	ackBase  uint32
	tsBase   uint32 // Linux offsets each connection's TSval by a random amount
	peerBase uint32 // stands in for the peer's TSval until it sends one
	ipID     uint16
	win      uint16
}

func newTCPCarrier(port uint16, peer *net.UDPAddr, opts *spoofOpts) (*tcpCarrier, error) {
	rx, err := openRawRecv(syscall.IPPROTO_TCP)
	if err != nil {
		return nil, err
	}
	c := &tcpCarrier{
		rx:    rx,
		rbuf:  make([]byte, 65535),
		port:  port,
		peer:  peer,
		opts:  opts,
		start: time.Now(),
		flows: map[[4]byte]*tcpFlow{},
	}
	c.fw = installFW("spoof tcp carrier", c.fwRules())
	return c, nil
}

func (c *tcpCarrier) flow(src net.IP) *tcpFlow {
	var k [4]byte
	copy(k[:], src.To4())
	f := c.flows[k]
	if f == nil {
		f = &tcpFlow{
			seq:      randU32(),
			ackBase:  randU32(),
			tsBase:   randU32(),
			peerBase: randU32(),
			ipID:     uint16(randU32()),
			// A window-scaled Linux connection advertises a few hundred to a
			// few thousand units; a fixed 0xFFFF with no scaling is a tell.
			win: uint16(400 + randU32()%1600),
		}
		c.flows[k] = f
	}
	return f
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
		if !c.opts.allowSrc(net.IP(c.rbuf[12:16])) {
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
		if ts, ok := tcpTSval(tcp[20:dataOff]); ok {
			atomic.StoreUint32(&c.peerTS, ts)
		}
		// Acknowledge what the peer sent, so our segments carry a moving ack
		// like a real established connection instead of a frozen one.
		atomic.AddUint32(&c.rcvd, uint32(len(payload)))
		return copy(p, payload), nil
	}
}

// tcpTSval pulls the TSval out of a TCP options block, if it carries one.
func tcpTSval(opts []byte) (uint32, bool) {
	for i := 0; i < len(opts); {
		switch opts[i] {
		case 0:
			return 0, false
		case 1:
			i++
			continue
		}
		if i+1 >= len(opts) || opts[i+1] < 2 || i+int(opts[i+1]) > len(opts) {
			return 0, false
		}
		if opts[i] == 8 && opts[i+1] == 10 {
			return binary.BigEndian.Uint32(opts[i+2 : i+6]), true
		}
		i += int(opts[i+1])
	}
	return 0, false
}

func (c *tcpCarrier) frame(src net.IP, payload []byte) ([]byte, error) {
	now := uint32(time.Since(c.start) / time.Millisecond)
	c.mu.Lock()
	f := c.flow(src)
	seg := tcpSeg{
		srcPort: c.opts.srcPort(c.port),
		dstPort: uint16(c.peer.Port),
		seq:     f.seq,
		ack:     f.ackBase + atomic.LoadUint32(&c.rcvd),
		ipID:    f.ipID,
		// A real receive window drifts as the buffer fills and drains.
		win:   f.win + uint16(mrand.Intn(32)),
		tsVal: f.tsBase + now,
		tsEcr: f.peerBase + now,
	}
	// Advance the sequence number by the payload length so the stream's
	// byte counter looks consistent to a stateful observer.
	f.seq += uint32(len(payload))
	f.ipID++
	c.mu.Unlock()
	if ts := atomic.LoadUint32(&c.peerTS); ts != 0 {
		seg.tsEcr = ts
	}
	pkt, err := buildTCPSegment(src, c.peer.IP, seg, payload)
	if err != nil {
		return nil, err
	}
	c.opts.decorate(pkt)
	return pkt, nil
}

func (c *tcpCarrier) setReadDeadline(t time.Time) error { return c.rx.SetReadDeadline(t) }
func (c *tcpCarrier) localAddr() net.Addr               { return &net.TCPAddr{Port: int(c.port)} }

func (c *tcpCarrier) close() error {
	removeFW("spoof tcp carrier", c.fw)
	c.fw = nil
	return c.rx.Close()
}

// fwRules for the tcp carrier. Our inbound segments arrive mid-stream with no
// handshake, so conntrack marks them INVALID; they are exempted from it and
// accepted, and so are our outbound ones for the same reason.
//
// The kernel also has no socket for those segments, so it answers each with an
// RST from our real IP:port to the forged (real, allow-listed) source. Those
// RSTs are noise aimed at an innocent address and a giveaway, so they are
// dropped on the way out. Only those: a segment carrying ACK is answered with
// a bare RST (RFC 793), while a real service on the same port aborts its own
// connections with RST|ACK, so matching RST without ACK leaves that service's
// resets alone. With a peer-source pin the drop is narrowed to RSTs aimed at
// those sources too.
func (c *tcpCarrier) fwRules() []fwRule {
	port := strconv.Itoa(int(c.port))
	pin := c.opts.peerList()
	in := []string{"-p", "tcp", "--dport", port}
	out := []string{"-p", "tcp", "-d", c.peer.IP.String(), "--dport", strconv.Itoa(c.peer.Port)}
	rst := []string{"-p", "tcp", "--sport", port, "--tcp-flags", "RST,ACK", "RST", "-j", "DROP"}
	if pin != "" {
		rst = append([]string{"-d", pin}, rst...)
	}
	return append(passRules(in, out, pin), fwRule{chain: "OUTPUT", args: rst})
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
	return buildSpoofedEcho(syscall.IPPROTO_ICMP, 0, srcIP, dstIP, id, seq, payload)
}

// buildSpoofedEcho assembles a forged-source IPv4 packet of protocol proto
// whose body is an Echo message of type echoType carrying payload after the
// 8-byte header: ICMP (1, type 0) or ICMPv6 (58, type 129). ICMPv6 has no
// pseudo-header defined over IPv4, so both are checksummed over the body.
func buildSpoofedEcho(proto, echoType byte, srcIP, dstIP net.IP, id, seq uint16, payload []byte) ([]byte, error) {
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
	pkt[9] = proto
	copy(pkt[12:16], src)
	copy(pkt[16:20], dst)
	binary.BigEndian.PutUint16(pkt[10:12], onesComplementSum(pkt[0:ipHdrLen]))

	icmp := pkt[ipHdrLen:]
	icmp[0] = echoType
	icmp[1] = 0 // code
	binary.BigEndian.PutUint16(icmp[4:6], id)
	binary.BigEndian.PutUint16(icmp[6:8], seq)
	copy(icmp[icmpHdrLen:], payload)
	// ICMP checksum covers the ICMP header and payload only (no pseudo-header).
	binary.BigEndian.PutUint16(icmp[2:4], onesComplementSum(icmp[:icmpHdrLen+len(payload)]))

	return pkt, nil
}

// buildSpoofedTCP assembles a forged-source IPv4 packet whose TCP body is a
// PSH|ACK segment carrying payload, with seq/ack as given and the rest of the
// fingerprint (IP id, window, timestamps) drawn at random.
func buildSpoofedTCP(srcIP, dstIP net.IP, srcPort, dstPort uint16, seq, ack uint32, payload []byte) ([]byte, error) {
	return buildTCPSegment(srcIP, dstIP, tcpSeg{
		srcPort: srcPort, dstPort: dstPort, seq: seq, ack: ack,
		ipID: uint16(randU32()), win: uint16(400 + randU32()%1600),
		tsVal: randU32(), tsEcr: randU32(),
	}, payload)
}

// tcpSeg is everything about one forged TCP segment besides its addresses and
// payload.
type tcpSeg struct {
	srcPort, dstPort uint16
	seq, ack         uint32
	ipID, win        uint16
	tsVal, tsEcr     uint32
}

// tcpOptsLen is the NOP, NOP, Timestamp block every segment of an established
// Linux connection carries.
const tcpOptsLen = 12

// buildTCPSegment assembles a forged-source IPv4 packet whose TCP body is a
// PSH|ACK segment carrying payload. There is no handshake because the far side
// reads with a raw socket, not the kernel TCP stack, so everything else is
// shaped to look like the middle of an established Linux connection: DF set
// with a moving IP id, a scaled-looking window and the timestamp option.
func buildTCPSegment(srcIP, dstIP net.IP, seg tcpSeg, payload []byte) ([]byte, error) {
	src, dst := srcIP.To4(), dstIP.To4()
	if src == nil || dst == nil {
		return nil, errIPv4Only
	}
	const ipHdrLen, tcpHdrLen = 20, 20 + tcpOptsLen
	total := ipHdrLen + tcpHdrLen + len(payload)
	pkt := make([]byte, total)

	pkt[0] = 0x45
	binary.BigEndian.PutUint16(pkt[2:4], uint16(total))
	binary.BigEndian.PutUint16(pkt[4:6], seg.ipID)
	pkt[6] = 0x40 // DF
	pkt[8] = 64
	pkt[9] = syscall.IPPROTO_TCP
	copy(pkt[12:16], src)
	copy(pkt[16:20], dst)
	binary.BigEndian.PutUint16(pkt[10:12], onesComplementSum(pkt[0:ipHdrLen]))

	tcp := pkt[ipHdrLen:]
	binary.BigEndian.PutUint16(tcp[0:2], seg.srcPort)
	binary.BigEndian.PutUint16(tcp[2:4], seg.dstPort)
	binary.BigEndian.PutUint32(tcp[4:8], seg.seq)
	binary.BigEndian.PutUint32(tcp[8:12], seg.ack)
	tcp[12] = tcpHdrLen / 4 << 4
	tcp[13] = 0x18 // flags: PSH | ACK
	binary.BigEndian.PutUint16(tcp[14:16], seg.win)
	tcp[20], tcp[21], tcp[22], tcp[23] = 1, 1, 8, 10 // NOP, NOP, Timestamp
	binary.BigEndian.PutUint32(tcp[24:28], seg.tsVal)
	binary.BigEndian.PutUint32(tcp[28:32], seg.tsEcr)
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
