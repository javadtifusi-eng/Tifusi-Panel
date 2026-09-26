package main

// linktest measures the route between the two servers before a transport is
// chosen: round-trip time, jitter and packet loss over UDP, and how reliably
// and how fast a TCP connection opens. The panel's transport recommendation
// can only probe each server from outside; this measures the path the tunnel
// will actually use, from one end to the other.
//
// The echo side (usually the Iran server) runs "linktest serve": a UDP echo
// and a TCP listener on one port. The other side runs "linktest run", which
// sends timestamped UDP probes, times TCP handshakes, and prints the numbers
// and a suggested transport.

import (
	"encoding/binary"
	"flag"
	"fmt"
	"math"
	"net"
	"os"
	"sort"
	"time"
)

var linkMagic = [4]byte{'T', 'F', 'L', 'T'}

const linkProbeLen = 16 // magic(4) | seq(4) | sent-at unix nanos(8)

func runLinkTest(args []string) {
	if len(args) == 0 {
		linkTestUsage()
		os.Exit(2)
	}
	switch args[0] {
	case "serve":
		linkTestServe(args[1:])
	case "run":
		linkTestRun(args[1:])
	default:
		linkTestUsage()
		os.Exit(2)
	}
}

func linkTestUsage() {
	fmt.Fprintln(os.Stderr, "usage:")
	fmt.Fprintln(os.Stderr, "  tifusi-tunnel linktest serve --port 8443 [--seconds 120]")
	fmt.Fprintln(os.Stderr, "  tifusi-tunnel linktest run --to <server-ip> --port 8443 [--count 100] [--interval 50ms] [--tcp 10]")
}

func linkTestServe(args []string) {
	fs := flag.NewFlagSet("linktest serve", flag.ExitOnError)
	port := fs.Int("port", 8443, "UDP and TCP port to answer on")
	seconds := fs.Int("seconds", 120, "how long to keep answering")
	fs.Parse(args)

	pc, err := net.ListenUDP("udp", &net.UDPAddr{Port: *port})
	if err != nil {
		fmt.Fprintf(os.Stderr, "linktest serve: udp: %v\n", err)
		os.Exit(1)
	}
	defer pc.Close()
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", *port))
	if err != nil {
		fmt.Fprintf(os.Stderr, "linktest serve: tcp: %v\n", err)
		os.Exit(1)
	}
	defer ln.Close()

	deadline := time.Now().Add(time.Duration(*seconds) * time.Second)
	fmt.Printf("answering on udp+tcp/%d for %ds — run the other side now\n", *port, *seconds)
	go func() {
		// The handshake is what's timed; the connection is closed straight away.
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	pc.SetReadDeadline(deadline)
	buf := make([]byte, 2048)
	echoed := 0
	for {
		n, from, err := pc.ReadFromUDP(buf)
		if err != nil {
			break
		}
		if n < linkProbeLen || [4]byte{buf[0], buf[1], buf[2], buf[3]} != linkMagic {
			continue
		}
		pc.WriteToUDP(buf[:n], from)
		echoed++
	}
	fmt.Printf("done — echoed %d udp probes\n", echoed)
}

// linkStats summarises a set of round-trip times.
type linkStats struct {
	sent, got          int
	min, avg, p95, max time.Duration
	jitter             time.Duration // mean difference between consecutive samples
}

func (s linkStats) loss() float64 {
	if s.sent == 0 {
		return 0
	}
	return 100 * float64(s.sent-s.got) / float64(s.sent)
}

func summarise(sent int, rtts []time.Duration) linkStats {
	st := linkStats{sent: sent, got: len(rtts)}
	if len(rtts) == 0 {
		return st
	}
	var sum, jit time.Duration
	for i, r := range rtts {
		sum += r
		if i > 0 {
			d := r - rtts[i-1]
			if d < 0 {
				d = -d
			}
			jit += d
		}
	}
	st.avg = sum / time.Duration(len(rtts))
	if len(rtts) > 1 {
		st.jitter = jit / time.Duration(len(rtts)-1)
	}
	sorted := append([]time.Duration(nil), rtts...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	st.min, st.max = sorted[0], sorted[len(sorted)-1]
	st.p95 = sorted[int(math.Ceil(0.95*float64(len(sorted))))-1]
	return st
}

func linkTestRun(args []string) {
	fs := flag.NewFlagSet("linktest run", flag.ExitOnError)
	to := fs.String("to", "", "the server running linktest serve")
	port := fs.Int("port", 8443, "its port")
	count := fs.Int("count", 100, "UDP probes to send")
	interval := fs.Duration("interval", 50*time.Millisecond, "delay between UDP probes")
	tcpTries := fs.Int("tcp", 10, "TCP handshakes to time")
	fs.Parse(args)
	if *to == "" || *count < 1 || *tcpTries < 0 {
		linkTestUsage()
		os.Exit(2)
	}
	addr := net.JoinHostPort(*to, fmt.Sprint(*port))

	udp := linkUDP(addr, *count, *interval)
	tcp, tcpFail := linkTCP(addr, *tcpTries)

	fmt.Printf("udp: %d/%d back  loss %.1f%%", udp.got, udp.sent, udp.loss())
	if udp.got > 0 {
		fmt.Printf("  rtt min/avg/p95/max %s/%s/%s/%s  jitter %s", ms(udp.min), ms(udp.avg), ms(udp.p95), ms(udp.max), ms(udp.jitter))
	}
	fmt.Println()
	if *tcpTries > 0 {
		fmt.Printf("tcp: %d/%d connected", tcp.got, *tcpTries)
		if tcp.got > 0 {
			fmt.Printf("  handshake avg/max %s/%s", ms(tcp.avg), ms(tcp.max))
		}
		if tcpFail != "" {
			fmt.Printf("  (%s)", tcpFail)
		}
		fmt.Println()
	}
	t, why := recommendTransport(udp, tcp, *tcpTries)
	fmt.Printf("suggested transport: %s — %s\n", t, why)
}

func linkUDP(addr string, count int, interval time.Duration) linkStats {
	conn, err := net.Dial("udp", addr)
	if err != nil {
		return linkStats{sent: count}
	}
	defer conn.Close()

	sentAt := make([]time.Time, count)
	rtt := make([]time.Duration, count)
	got := make([]bool, count)
	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 2048)
		for {
			conn.SetReadDeadline(time.Now().Add(2 * time.Second))
			n, err := conn.Read(buf)
			if err != nil {
				return // two quiet seconds after the last probe ends the run
			}
			if n < linkProbeLen || [4]byte{buf[0], buf[1], buf[2], buf[3]} != linkMagic {
				continue
			}
			seq := binary.BigEndian.Uint32(buf[4:8])
			if int(seq) < count && !got[seq] {
				got[seq] = true
				rtt[seq] = time.Since(sentAt[seq])
			}
		}
	}()
	p := make([]byte, linkProbeLen)
	copy(p, linkMagic[:])
	for i := 0; i < count; i++ {
		binary.BigEndian.PutUint32(p[4:8], uint32(i))
		sentAt[i] = time.Now()
		binary.BigEndian.PutUint64(p[8:16], uint64(sentAt[i].UnixNano()))
		conn.Write(p)
		time.Sleep(interval)
	}
	<-done
	// In send order, so jitter compares neighbours in time.
	var rtts []time.Duration
	for i := range got {
		if got[i] {
			rtts = append(rtts, rtt[i])
		}
	}
	return summarise(count, rtts)
}

func linkTCP(addr string, tries int) (linkStats, string) {
	var rtts []time.Duration
	var lastErr string
	for i := 0; i < tries; i++ {
		start := time.Now()
		c, err := net.DialTimeout("tcp", addr, 5*time.Second)
		if err != nil {
			lastErr = err.Error()
			continue
		}
		rtts = append(rtts, time.Since(start))
		c.Close()
		time.Sleep(100 * time.Millisecond)
	}
	return summarise(tries, rtts), lastErr
}

// recommendTransport turns the measurements into one of the tunnel's
// transports. It is a starting point from what the path did during the test,
// not a promise about how a filter will treat each transport later.
func recommendTransport(udp, tcp linkStats, tcpTries int) (string, string) {
	tcpOK := tcpTries == 0 || tcp.got*10 >= tcpTries*9 // at least 90% connected
	switch {
	case udp.got == 0 && !tcpOK:
		return "none", "neither UDP nor TCP got through on this port; check the port is open, then try wssmux through a CDN"
	case udp.got == 0:
		return "tcpmux", "UDP didn't come back at all; stay on TCP (wssmux through a CDN if this IP gets filtered)"
	case !tcpOK:
		return "udp", "TCP handshakes are failing while UDP gets through; KCP over UDP with FEC"
	case udp.loss() >= 3 || udp.jitter >= 30*time.Millisecond:
		return "udp", fmt.Sprintf("%.1f%% loss / %s jitter makes TCP back off; KCP with FEC rebuilds lost packets", udp.loss(), ms(udp.jitter))
	default:
		return "tcpmux", "clean path; plain TCP mux has the least overhead"
	}
}

func ms(d time.Duration) string {
	return fmt.Sprintf("%.1fms", float64(d.Microseconds())/1000)
}
