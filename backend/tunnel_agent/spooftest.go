package main

// spooftest answers one question before any spoofing tunnel is worth
// building: will this datacenter actually let a packet leave with a forged
// source IP? During Iran's national-internet mode the filtering is at L3
// (source/destination IP allow-listing), so the only way through is to send
// with a source IP that is on the allow-list. Many providers enforce BCP38
// egress filtering and silently drop such packets, so this has to be
// measured per host, not assumed.
//
// How it works: the sender (run on the Iran server) crafts raw IPv4+UDP
// packets whose source field is a forged IP and sends them to the receiver's
// real IP. The receiver is a PLAIN UDP listener — nothing special — because
// the packet's DESTINATION is its own real address, so the kernel delivers
// it normally; only the return path would be broken, which the test doesn't
// need. The receiver reports which forged sources actually arrived. Reverse
// the roles to measure the other direction.

import (
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
	"net"
	"os"
	"sort"
	"strings"
	"syscall"
	"time"
)

// spoofMagic tags our probe payload so a listener never confuses unrelated
// noise for a probe. Layout: magic(4) | claimedSrc(4) | seq(4) | sent(2),
// where sent is how many probes the sender sends per forged source, so the
// receiver can work out each source's loss without being told separately.
var spoofMagic = [4]byte{'T', 'F', 'S', 'P'}

const (
	spoofPayloadLen = 14
	// A sender from before the per-source count sent only the first 12 bytes.
	spoofPayloadMinLen = 12
)

// The protocols a probe can be carried on. A datacenter or the national
// filter can treat them differently, so each is worth measuring on its own.
const (
	probeUDP    = "udp"
	probeICMP   = "icmp"
	probeICMPv6 = "icmpv6"
	probeTCP    = "tcp"
)

func validProbeProto(p string) bool {
	return p == probeUDP || p == probeICMP || p == probeICMPv6 || p == probeTCP
}

func buildProbePayload(claimedSrc net.IP, seq uint32, sent uint16) []byte {
	p := make([]byte, spoofPayloadLen)
	copy(p[0:4], spoofMagic[:])
	copy(p[4:8], claimedSrc.To4())
	binary.BigEndian.PutUint32(p[8:12], seq)
	binary.BigEndian.PutUint16(p[12:14], sent)
	return p
}

// parseProbePayload returns sent = 0 for a probe from an older sender, which
// didn't say how many it sent.
func parseProbePayload(p []byte) (claimedSrc net.IP, seq uint32, sent uint16, ok bool) {
	if len(p) < spoofPayloadMinLen {
		return nil, 0, 0, false
	}
	if [4]byte{p[0], p[1], p[2], p[3]} != spoofMagic {
		return nil, 0, 0, false
	}
	if len(p) >= spoofPayloadLen {
		sent = binary.BigEndian.Uint16(p[12:14])
	}
	return net.IPv4(p[4], p[5], p[6], p[7]), binary.BigEndian.Uint32(p[8:12]), sent, true
}

// onesComplementSum is the checksum used by both the IP and UDP headers:
// a 16-bit ones-complement sum, then complemented.
func onesComplementSum(b []byte) uint16 {
	var sum uint32
	for i := 0; i+1 < len(b); i += 2 {
		sum += uint32(b[i])<<8 | uint32(b[i+1])
	}
	if len(b)%2 == 1 {
		sum += uint32(b[len(b)-1]) << 8
	}
	for sum>>16 != 0 {
		sum = (sum & 0xffff) + (sum >> 16)
	}
	return ^uint16(sum)
}

// buildSpoofedUDP assembles a full IPv4 + UDP datagram whose source address
// is srcIP (the forged one) rather than the host's real address. It is the
// one place a source IP is actually rewritten; everything else is plumbing.
func buildSpoofedUDP(srcIP, dstIP net.IP, srcPort, dstPort uint16, payload []byte) ([]byte, error) {
	src, dst := srcIP.To4(), dstIP.To4()
	if src == nil || dst == nil {
		return nil, errors.New("spooftest only supports IPv4 addresses")
	}

	const ipHdrLen, udpHdrLen = 20, 8
	total := ipHdrLen + udpHdrLen + len(payload)
	pkt := make([]byte, total)

	// IPv4 header.
	pkt[0] = 0x45 // version 4, IHL 5 (no options)
	pkt[1] = 0    // DSCP/ECN
	binary.BigEndian.PutUint16(pkt[2:4], uint16(total))
	binary.BigEndian.PutUint16(pkt[4:6], 0) // ID (kernel fills if left 0)
	binary.BigEndian.PutUint16(pkt[6:8], 0) // flags/fragment offset
	pkt[8] = 64                             // TTL
	pkt[9] = syscall.IPPROTO_UDP
	copy(pkt[12:16], src)
	copy(pkt[16:20], dst)
	binary.BigEndian.PutUint16(pkt[10:12], onesComplementSum(pkt[0:ipHdrLen]))

	// UDP header.
	udp := pkt[ipHdrLen:]
	binary.BigEndian.PutUint16(udp[0:2], srcPort)
	binary.BigEndian.PutUint16(udp[2:4], dstPort)
	binary.BigEndian.PutUint16(udp[4:6], uint16(udpHdrLen+len(payload)))
	copy(udp[udpHdrLen:], payload)

	// UDP checksum covers a pseudo-header (src, dst, proto, udp length) plus
	// the UDP header and payload.
	pseudo := make([]byte, 12+udpHdrLen+len(payload))
	copy(pseudo[0:4], src)
	copy(pseudo[4:8], dst)
	pseudo[9] = syscall.IPPROTO_UDP
	binary.BigEndian.PutUint16(pseudo[10:12], uint16(udpHdrLen+len(payload)))
	copy(pseudo[12:], udp[:udpHdrLen+len(payload)])
	cksum := onesComplementSum(pseudo)
	if cksum == 0 {
		cksum = 0xffff // 0 means "no checksum"; the real 0 is sent as all-ones
	}
	binary.BigEndian.PutUint16(udp[6:8], cksum)

	return pkt, nil
}

// spoofSender holds an open raw socket for sending forged-source datagrams.
type spoofSender struct {
	fd int
}

func newSpoofSender() (*spoofSender, error) {
	fd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_RAW, syscall.IPPROTO_RAW)
	if err != nil {
		return nil, fmt.Errorf("open raw socket (need root/CAP_NET_RAW): %w", err)
	}
	// We supply the whole IP header, forged source and all.
	if err := syscall.SetsockoptInt(fd, syscall.IPPROTO_IP, syscall.IP_HDRINCL, 1); err != nil {
		syscall.Close(fd)
		return nil, fmt.Errorf("set IP_HDRINCL: %w", err)
	}
	return &spoofSender{fd: fd}, nil
}

// sendPacket writes an already-assembled IPv4 packet (source IP forged and
// all, since the socket was opened with IP_HDRINCL) out to dstIP. Every
// carrier ultimately reaches the wire through here.
func (s *spoofSender) sendPacket(pkt []byte, dstIP net.IP) error {
	var addr syscall.SockaddrInet4
	copy(addr.Addr[:], dstIP.To4())
	return syscall.Sendto(s.fd, pkt, 0, &addr)
}

func (s *spoofSender) send(srcIP, dstIP net.IP, srcPort, dstPort uint16, payload []byte) error {
	pkt, err := buildSpoofedUDP(srcIP, dstIP, srcPort, dstPort, payload)
	if err != nil {
		return err
	}
	return s.sendPacket(pkt, dstIP)
}

// buildProbePacket wraps one probe payload in the chosen protocol. ICMP goes
// as an Echo Reply and TCP as a PSH|ACK segment, the same shapes the tunnel's
// icmp and tcp carriers use, so a pass here means those carriers would pass.
func buildProbePacket(proto string, srcIP, dstIP net.IP, srcPort, dstPort uint16, seq uint32, payload []byte) ([]byte, error) {
	switch proto {
	case probeICMP:
		return buildSpoofedICMP(srcIP, dstIP, spoofTestICMPID, uint16(seq), payload)
	case probeICMPv6:
		return buildSpoofedEcho(ipProtoICMPv6, 129, srcIP, dstIP, spoofTestICMPID, uint16(seq), payload)
	case probeTCP:
		return buildSpoofedTCP(srcIP, dstIP, srcPort, dstPort, seq, randU32(), payload)
	default:
		return buildSpoofedUDP(srcIP, dstIP, srcPort, dstPort, payload)
	}
}

// spoofTestICMPID is the Echo id probes carry; the receiver matches on the
// payload magic, so it only has to differ from the tunnel's own id.
const spoofTestICMPID uint16 = 0xF5F2

func (s *spoofSender) close() { syscall.Close(s.fd) }

// expandIPs turns "1.2.3.4", "1.2.3.4-1.2.3.20", or "1.2.3.0/24" into the
// concrete list of addresses to try as forged sources.
func expandIPs(spec string) ([]net.IP, error) {
	// A count over this many addresses is rejected up front, before any list is
	// built, so a huge CIDR or range can never balloon memory first.
	const maxIPs = 65536
	if _, cidr, err := net.ParseCIDR(spec); err == nil {
		ones, bits := cidr.Mask.Size()
		if bits != 32 {
			return nil, fmt.Errorf("spooftest only supports IPv4 CIDRs: %q", spec)
		}
		if bits-ones > 16 {
			return nil, fmt.Errorf("CIDR %q expands to more than %d addresses", spec, maxIPs)
		}
		var out []net.IP
		for ip := cidr.IP.Mask(cidr.Mask); cidr.Contains(ip); ip = nextIP(ip) {
			out = append(out, dupIP(ip))
		}
		return out, nil
	}
	if lo, hi, ok := splitRange(spec); ok {
		loIP, hiIP := net.ParseIP(lo).To4(), net.ParseIP(hi).To4()
		if loIP == nil || hiIP == nil {
			return nil, fmt.Errorf("invalid range %q", spec)
		}
		if ipToU32(loIP) > ipToU32(hiIP) {
			return nil, fmt.Errorf("range %q starts above it ends", spec)
		}
		if ipToU32(hiIP)-ipToU32(loIP) >= maxIPs {
			return nil, fmt.Errorf("range %q spans more than %d addresses", spec, maxIPs)
		}
		var out []net.IP
		for ip := loIP; ; ip = nextIP(ip) {
			out = append(out, dupIP(ip))
			if ipToU32(ip) == ipToU32(hiIP) {
				break
			}
		}
		return out, nil
	}
	if ip := net.ParseIP(spec).To4(); ip != nil {
		return []net.IP{ip}, nil
	}
	return nil, fmt.Errorf("not an IP, range or CIDR: %q", spec)
}

func splitRange(spec string) (lo, hi string, ok bool) {
	for i := 0; i < len(spec); i++ {
		if spec[i] == '-' {
			return spec[:i], spec[i+1:], true
		}
	}
	return "", "", false
}

func ipToU32(ip net.IP) uint32 { return binary.BigEndian.Uint32(ip.To4()) }

func nextIP(ip net.IP) net.IP {
	n := make(net.IP, 4)
	binary.BigEndian.PutUint32(n, ipToU32(ip)+1)
	return n
}

func dupIP(ip net.IP) net.IP {
	d := make(net.IP, 4)
	copy(d, ip.To4())
	return d
}

// runSpoofTest is the "spooftest" subcommand entry point.
func runSpoofTest(args []string) {
	if len(args) == 0 {
		spoofTestUsage()
		os.Exit(2)
	}
	switch args[0] {
	case "send":
		spoofTestSend(args[1:])
	case "recv":
		spoofTestRecv(args[1:])
	default:
		spoofTestUsage()
		os.Exit(2)
	}
}

func spoofTestUsage() {
	fmt.Fprintln(os.Stderr, "usage:")
	fmt.Fprintln(os.Stderr, "  tifusi-tunnel spooftest recv --port 443 [--proto udp|icmp|icmpv6|tcp] [--seconds 20] [--max-loss 100] [--out file]")
	fmt.Fprintln(os.Stderr, "  tifusi-tunnel spooftest send --to <receiver-ip> --port 443 --spoof <ip|a-b|cidr|list> [--proto udp|icmp|icmpv6|tcp] [--count 3] [--interval 50ms] [--sport 40000]")
}

func spoofTestSend(args []string) {
	fs := flag.NewFlagSet("spooftest send", flag.ExitOnError)
	to := fs.String("to", "", "receiver's real IP")
	port := fs.Int("port", 443, "receiver port (udp/tcp; ignored for icmp/icmpv6)")
	proto := fs.String("proto", probeUDP, "protocol to carry the probes on: udp, icmp, icmpv6 or tcp")
	spoof := fs.String("spoof", "", "forged source: IP, range (a-b), CIDR, or comma-separated list")
	count := fs.Int("count", 3, "packets per forged source")
	sport := fs.Int("sport", 40000, "source port to put in forged packets (udp/tcp)")
	interval := fs.Duration("interval", 50*time.Millisecond, "delay between packets")
	fs.Parse(args)

	if !validProbeProto(*proto) {
		fmt.Fprintln(os.Stderr, "spooftest send: --proto must be udp, icmp, icmpv6 or tcp")
		os.Exit(2)
	}
	if *count < 1 || *count > 65535 {
		fmt.Fprintln(os.Stderr, "spooftest send: --count must be 1-65535")
		os.Exit(2)
	}
	dst := net.ParseIP(*to).To4()
	if dst == nil {
		fmt.Fprintln(os.Stderr, "spooftest send: --to must be an IPv4 address")
		os.Exit(2)
	}
	// parseSpoofSources (not expandIPs) so a discovery run can sweep a whole
	// comma-separated candidate list in one pass, not just one ip/range/CIDR.
	ips, err := parseSpoofSources(*spoof)
	if err != nil {
		fmt.Fprintf(os.Stderr, "spooftest send: %v\n", err)
		os.Exit(2)
	}

	sender, err := newSpoofSender()
	if err != nil {
		fmt.Fprintf(os.Stderr, "spooftest send: %v\n", err)
		os.Exit(1)
	}
	defer sender.close()

	fmt.Printf("sending %d forged sources x%d over %s to %s:%d\n", len(ips), *count, *proto, *to, *port)
	var seq uint32
	for _, src := range ips {
		for i := 0; i < *count; i++ {
			seq++
			payload := buildProbePayload(src, seq, uint16(*count))
			pkt, err := buildProbePacket(*proto, src, dst, uint16(*sport), uint16(*port), seq, payload)
			if err == nil {
				err = sender.sendPacket(pkt, dst)
			}
			if err != nil {
				fmt.Fprintf(os.Stderr, "send from %s: %v\n", src, err)
			}
			time.Sleep(*interval)
		}
	}
	fmt.Println("done — check the receiver for which sources arrived")
}

// probeReader yields the payload of each probe that reaches this host, and
// the source address the kernel saw it arrive from.
type probeReader interface {
	read(buf []byte) (payload []byte, from net.IP, err error)
	close()
}

type udpProbeReader struct{ conn *net.UDPConn }

func (r udpProbeReader) read(buf []byte) ([]byte, net.IP, error) {
	n, from, err := r.conn.ReadFromUDP(buf)
	if err != nil {
		return nil, nil, err
	}
	return buf[:n], from.IP, nil
}

func (r udpProbeReader) close() { r.conn.Close() }

// rawProbeReader reads ICMP or TCP probes off a raw socket, which gets a copy
// of every such packet the host receives: nothing listens for a forged TCP
// segment, and an Echo Reply nobody asked for is otherwise dropped.
type rawProbeReader struct {
	f     *os.File
	proto string
	port  uint16
}

func (r rawProbeReader) read(buf []byte) ([]byte, net.IP, error) {
	for {
		n, err := r.f.Read(buf)
		if err != nil {
			return nil, nil, err
		}
		if payload := rawProbePayload(r.proto, r.port, buf[:n]); payload != nil {
			return payload, dupIP(net.IP(buf[12:16])), nil
		}
	}
}

func (r rawProbeReader) close() { r.f.Close() }

// rawProbePayload strips the IPv4 and ICMP/TCP headers from a packet read off
// a raw socket, or returns nil for anything that isn't a probe to us.
func rawProbePayload(proto string, port uint16, pkt []byte) []byte {
	ihl := ipHeaderLen(pkt)
	if ihl == 0 || len(pkt) < ihl {
		return nil
	}
	body := pkt[ihl:]
	switch proto {
	case probeICMP, probeICMPv6:
		echoReply := byte(0)
		if proto == probeICMPv6 {
			echoReply = 129
		}
		if len(body) < 8 || body[0] != echoReply {
			return nil
		}
		return body[8:]
	case probeTCP:
		if len(body) < 20 || binary.BigEndian.Uint16(body[2:4]) != port {
			return nil
		}
		off := int(body[12]>>4) * 4
		if off < 20 || off > len(body) {
			return nil
		}
		return body[off:]
	}
	return nil
}

func openProbeReader(proto string, port int) (probeReader, error) {
	switch proto {
	case probeICMP:
		f, err := openRawRecv(syscall.IPPROTO_ICMP)
		if err != nil {
			return nil, err
		}
		return rawProbeReader{f: f, proto: proto}, nil
	case probeICMPv6:
		f, err := openRawRecv(ipProtoICMPv6)
		if err != nil {
			return nil, err
		}
		return rawProbeReader{f: f, proto: proto}, nil
	case probeTCP:
		f, err := openRawRecv(syscall.IPPROTO_TCP)
		if err != nil {
			return nil, err
		}
		return rawProbeReader{f: f, proto: proto, port: uint16(port)}, nil
	default:
		conn, err := net.ListenUDP("udp4", &net.UDPAddr{Port: port})
		if err != nil {
			return nil, err
		}
		return udpProbeReader{conn: conn}, nil
	}
}

// probeStat is what the receiver learned about one forged source.
type probeStat struct {
	got  int
	sent int // 0 when an older sender didn't say
}

// loss is the percentage of this source's probes that never arrived, or -1
// when the sender didn't say how many it sent.
func (s probeStat) loss() float64 {
	if s.sent <= 0 {
		return -1
	}
	got := s.got
	if got > s.sent { // a duplicated packet can't make loss negative
		got = s.sent
	}
	return 100 * float64(s.sent-got) / float64(s.sent)
}

func spoofTestRecv(args []string) {
	fs := flag.NewFlagSet("spooftest recv", flag.ExitOnError)
	port := fs.Int("port", 443, "port to listen on (udp/tcp; ignored for icmp/icmpv6)")
	proto := fs.String("proto", probeUDP, "protocol the sender uses: udp, icmp, icmpv6 or tcp")
	seconds := fs.Int("seconds", 20, "how long to listen")
	maxLoss := fs.Float64("max-loss", 100, "only count a source as usable at or below this packet loss (%)")
	out := fs.String("out", "", "write the usable sources to this file, one per line (the other side's spoof list)")
	fs.Parse(args)

	if !validProbeProto(*proto) {
		fmt.Fprintln(os.Stderr, "spooftest recv: --proto must be udp, icmp, icmpv6 or tcp")
		os.Exit(2)
	}
	reader, err := openProbeReader(*proto, *port)
	if err != nil {
		fmt.Fprintf(os.Stderr, "spooftest recv: %v\n", err)
		os.Exit(1)
	}
	defer reader.close()

	where := fmt.Sprintf("%s/%d", *proto, *port)
	if *proto == probeICMP || *proto == probeICMPv6 {
		where = *proto
	}
	fmt.Printf("listening on %s for %ds — start the sender now\n", where, *seconds)
	deadline := time.Now().Add(time.Duration(*seconds) * time.Second)

	seen := map[string]*probeStat{}
	buf := make([]byte, 65535)
	for time.Now().Before(deadline) {
		switch r := reader.(type) {
		case udpProbeReader:
			r.conn.SetReadDeadline(deadline)
		case rawProbeReader:
			r.f.SetReadDeadline(deadline)
		}
		payload, from, err := reader.read(buf)
		if err != nil {
			if errors.Is(err, os.ErrDeadlineExceeded) {
				break
			}
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				break
			}
			continue
		}
		claimed, _, sent, ok := parseProbePayload(payload)
		if !ok {
			continue
		}
		s := seen[claimed.String()]
		if s == nil {
			s = &probeStat{}
			seen[claimed.String()] = s
		}
		s.got++
		if int(sent) > s.sent {
			s.sent = int(sent)
		}
		// The forged source the kernel reports (from) should equal the one
		// we baked into the payload — if a NAT rewrote it, they differ.
		if !from.Equal(claimed) {
			fmt.Printf("  note: claimed %s but kernel saw %s (a NAT rewrote the source)\n", claimed, from)
		}
	}

	if len(seen) == 0 {
		fmt.Printf("no forged packets arrived over %s — this path drops spoofed sources (BCP38)\n", *proto)
		return
	}
	arrived := make([]string, 0, len(seen))
	for ip := range seen {
		arrived = append(arrived, ip)
	}
	sort.Slice(arrived, func(i, j int) bool {
		return ipToU32(net.ParseIP(arrived[i])) < ipToU32(net.ParseIP(arrived[j]))
	})
	var usable []string
	fmt.Printf("%d forged sources made it through over %s:\n", len(arrived), *proto)
	for _, ip := range arrived {
		s := *seen[ip]
		loss := s.loss()
		ok := loss <= *maxLoss
		if ok {
			usable = append(usable, ip)
		}
		mark := " "
		if !ok {
			mark = "x"
		}
		if loss < 0 {
			fmt.Printf(" %s %-15s  %d packets\n", mark, ip, s.got)
		} else {
			fmt.Printf(" %s %-15s  %d/%d packets  loss %.0f%%\n", mark, ip, min(s.got, s.sent), s.sent, loss)
		}
	}
	fmt.Printf("%d usable at max loss %.0f%%\n", len(usable), *maxLoss)
	if *out != "" {
		data := strings.Join(usable, "\n")
		if data != "" {
			data += "\n"
		}
		if err := os.WriteFile(*out, []byte(data), 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "spooftest recv: write %s: %v\n", *out, err)
			os.Exit(1)
		}
		fmt.Printf("wrote %s — use it as the spoof list on the OTHER side\n", *out)
	}
}
