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
	"sync"
	"syscall"
	"time"
)

// spoofMagic tags our probe payload so a listener never confuses unrelated
// UDP noise on the port for a probe. Layout: magic(4) | claimedSrc(4) | seq(4).
var spoofMagic = [4]byte{'T', 'F', 'S', 'P'}

const spoofPayloadLen = 12

func buildProbePayload(claimedSrc net.IP, seq uint32) []byte {
	p := make([]byte, spoofPayloadLen)
	copy(p[0:4], spoofMagic[:])
	copy(p[4:8], claimedSrc.To4())
	binary.BigEndian.PutUint32(p[8:12], seq)
	return p
}

func parseProbePayload(p []byte) (claimedSrc net.IP, seq uint32, ok bool) {
	if len(p) < spoofPayloadLen {
		return nil, 0, false
	}
	if [4]byte{p[0], p[1], p[2], p[3]} != spoofMagic {
		return nil, 0, false
	}
	return net.IPv4(p[4], p[5], p[6], p[7]), binary.BigEndian.Uint32(p[8:12]), true
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
	fmt.Fprintln(os.Stderr, "  tifusi-tunnel spooftest recv --port 443 [--seconds 20]")
	fmt.Fprintln(os.Stderr, "  tifusi-tunnel spooftest send --to <receiver-ip> --port 443 --spoof <ip|a-b|cidr> [--count 3] [--interval 50ms] [--sport 40000]")
}

func spoofTestSend(args []string) {
	fs := flag.NewFlagSet("spooftest send", flag.ExitOnError)
	to := fs.String("to", "", "receiver's real IP")
	port := fs.Int("port", 443, "receiver UDP port")
	spoof := fs.String("spoof", "", "forged source IP, range (a-b) or CIDR")
	count := fs.Int("count", 3, "packets per forged source")
	sport := fs.Int("sport", 40000, "UDP source port to put in forged packets")
	interval := fs.Duration("interval", 50*time.Millisecond, "delay between packets")
	fs.Parse(args)

	dst := net.ParseIP(*to).To4()
	if dst == nil {
		fmt.Fprintln(os.Stderr, "spooftest send: --to must be an IPv4 address")
		os.Exit(2)
	}
	ips, err := expandIPs(*spoof)
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

	fmt.Printf("sending %d forged sources x%d to %s:%d\n", len(ips), *count, *to, *port)
	var seq uint32
	for _, src := range ips {
		for i := 0; i < *count; i++ {
			seq++
			payload := buildProbePayload(src, seq)
			if err := sender.send(src, dst, uint16(*sport), uint16(*port), payload); err != nil {
				fmt.Fprintf(os.Stderr, "send from %s: %v\n", src, err)
			}
			time.Sleep(*interval)
		}
	}
	fmt.Println("done — check the receiver for which sources arrived")
}

func spoofTestRecv(args []string) {
	fs := flag.NewFlagSet("spooftest recv", flag.ExitOnError)
	port := fs.Int("port", 443, "UDP port to listen on")
	seconds := fs.Int("seconds", 20, "how long to listen")
	fs.Parse(args)

	conn, err := net.ListenUDP("udp4", &net.UDPAddr{Port: *port})
	if err != nil {
		fmt.Fprintf(os.Stderr, "spooftest recv: %v\n", err)
		os.Exit(1)
	}
	defer conn.Close()

	fmt.Printf("listening on udp/%d for %ds — start the sender now\n", *port, *seconds)
	deadline := time.Now().Add(time.Duration(*seconds) * time.Second)
	conn.SetReadDeadline(deadline)

	type stat struct{ got int }
	var mu sync.Mutex
	seen := map[string]*stat{}
	buf := make([]byte, 2048)
	for {
		n, from, err := conn.ReadFromUDP(buf)
		if err != nil {
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				break
			}
			continue
		}
		claimed, _, ok := parseProbePayload(buf[:n])
		if !ok {
			continue
		}
		mu.Lock()
		s := seen[claimed.String()]
		if s == nil {
			s = &stat{}
			seen[claimed.String()] = s
		}
		s.got++
		mu.Unlock()
		// The forged source the kernel reports (from) should equal the one
		// we baked into the payload — if a NAT rewrote it, they differ.
		if !from.IP.Equal(claimed) {
			fmt.Printf("  note: claimed %s but kernel saw %s (a NAT rewrote the source)\n", claimed, from.IP)
		}
	}

	if len(seen) == 0 {
		fmt.Println("no forged packets arrived — this datacenter is dropping spoofed sources (BCP38)")
		return
	}
	arrived := make([]string, 0, len(seen))
	for ip := range seen {
		arrived = append(arrived, ip)
	}
	sort.Strings(arrived)
	fmt.Printf("%d forged sources made it through:\n", len(arrived))
	for _, ip := range arrived {
		fmt.Printf("  %s  (%d packets)\n", ip, seen[ip].got)
	}
}
