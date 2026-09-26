package main

// Raw UDP relay for "udp" forwards (config "udp_raw"), the approach Backhaul
// uses: each UDP flow gets its own UDP socket between the two servers and its
// datagrams cross one-for-one. Nothing is reordered, retransmitted or
// congestion-controlled on the way, so a protocol that already does that
// itself (WireGuard carrying TCP) runs at link speed instead of stalling
// behind KCP's reliable stream.
//
// The foreign side keeps cfg.Pool idle sockets registered with the Iran side
// on tunnel port + 1. A new local flow on the Iran side claims one; its first
// packets carry the target so the foreign side knows what to dial.

import (
	"bytes"
	"log"
	"net"
	"strconv"
	"sync"
	"time"
)

const (
	rawHello  = 0x00 // client -> server: token, register/keep alive
	rawTarget = 0x01 // server -> client: len(1) target payload
	rawData   = 0x02 // either way: payload

	rawIdle      = 120 * time.Second // flow closed after this long silent
	rawKeepalive = 10 * time.Second
	rawStale     = 35 * time.Second // idle socket forgotten without a hello
)

// rawAddr is the raw relay's port: the tunnel port + 1.
func rawAddr(addr string) (string, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "", err
	}
	p, err := strconv.Atoi(port)
	if err != nil {
		return "", err
	}
	return net.JoinHostPort(host, strconv.Itoa(p+1)), nil
}

func rawSockBuf(c *net.UDPConn) {
	c.SetReadBuffer(kcpSockBuf)
	c.SetWriteBuffer(kcpSockBuf)
}

// ---------------------------------------------------------------- server

type rawPeer struct {
	addr  *net.UDPAddr
	mu    sync.Mutex
	seen  time.Time
	flow  *rawFlow // nil while idle
	acked bool     // peer has sent data back, target no longer needed
}

type rawFlow struct {
	peer   *rawPeer
	pc     net.PacketConn // the forward's listener
	client net.Addr       // local user address on the Iran side
	target string
	last   time.Time
}

type rawServer struct {
	s     *Server
	token []byte
	conn  *net.UDPConn
	mu    sync.Mutex
	peers map[string]*rawPeer
	idle  []*rawPeer
}

func (s *Server) startRaw() (*rawServer, error) {
	addr, err := rawAddr(s.cfg.Listen)
	if err != nil {
		return nil, err
	}
	ua, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		return nil, err
	}
	conn, err := net.ListenUDP("udp", ua)
	if err != nil {
		return nil, err
	}
	rawSockBuf(conn)
	r := &rawServer{s: s, token: []byte(s.cfg.Token), conn: conn, peers: map[string]*rawPeer{}}
	s.log("raw udp relay listening on %s", addr)
	go r.readLoop()
	go r.reap()
	return r, nil
}

func (r *rawServer) readLoop() {
	buf := make([]byte, 65535)
	for {
		n, from, err := r.conn.ReadFromUDP(buf)
		if err != nil {
			time.Sleep(100 * time.Millisecond)
			continue
		}
		if n < 1 {
			continue
		}
		key := from.String()
		r.mu.Lock()
		p := r.peers[key]
		switch buf[0] {
		case rawHello:
			if !bytes.Equal(buf[1:n], r.token) {
				r.mu.Unlock()
				continue
			}
			if p == nil {
				p = &rawPeer{addr: from}
				r.peers[key] = p
				r.idle = append(r.idle, p)
			}
			p.mu.Lock()
			p.seen = time.Now()
			p.mu.Unlock()
			r.mu.Unlock()
		case rawData:
			r.mu.Unlock()
			if p == nil {
				continue
			}
			p.mu.Lock()
			f := p.flow
			p.seen = time.Now()
			p.acked = true
			if f != nil {
				f.last = p.seen
			}
			p.mu.Unlock()
			if f != nil {
				f.pc.WriteTo(buf[1:n], f.client)
			}
		default:
			r.mu.Unlock()
		}
	}
}

// claim hands out a live idle peer, or nil when the pool is empty.
func (r *rawServer) claim() *rawPeer {
	r.mu.Lock()
	defer r.mu.Unlock()
	for len(r.idle) > 0 {
		p := r.idle[0]
		r.idle = r.idle[1:]
		p.mu.Lock()
		ok := time.Since(p.seen) < rawStale && p.flow == nil
		p.mu.Unlock()
		if ok {
			return p
		}
		delete(r.peers, p.addr.String())
	}
	return nil
}

func (r *rawServer) send(f *rawFlow, payload []byte) {
	p := f.peer
	p.mu.Lock()
	acked := p.acked
	f.last = time.Now()
	p.mu.Unlock()
	var pkt []byte
	if acked {
		pkt = make([]byte, 0, 1+len(payload))
		pkt = append(pkt, rawData)
	} else {
		pkt = make([]byte, 0, 2+len(f.target)+len(payload))
		pkt = append(pkt, rawTarget, byte(len(f.target)))
		pkt = append(pkt, f.target...)
	}
	pkt = append(pkt, payload...)
	r.conn.WriteToUDP(pkt, p.addr)
}

// reap drops stale idle sockets and ends flows that went silent.
func (r *rawServer) reap() {
	for range time.Tick(10 * time.Second) {
		r.mu.Lock()
		for k, p := range r.peers {
			p.mu.Lock()
			dead := time.Since(p.seen) > rawStale
			if p.flow != nil && time.Since(p.flow.last) > rawIdle {
				dead = true
			}
			p.mu.Unlock()
			if dead {
				delete(r.peers, k)
			}
		}
		r.mu.Unlock()
	}
}

func (s *Server) serveUDPForwardRaw(r *rawServer, fw Forward) {
	pc, err := net.ListenPacket("udp", fw.Listen)
	if err != nil {
		s.log("forward %s: %v", fw.Listen, err)
		return
	}
	if uc, ok := pc.(*net.UDPConn); ok {
		rawSockBuf(uc)
	}
	s.log("forwarding udp %s -> %s %s (raw)", fw.Listen, fw.Target, label(fw))
	var mu sync.Mutex
	flows := map[string]*rawFlow{}
	go func() {
		for range time.Tick(10 * time.Second) {
			mu.Lock()
			for k, f := range flows {
				f.peer.mu.Lock()
				idle := time.Since(f.last) > rawIdle
				f.peer.mu.Unlock()
				if idle {
					delete(flows, k)
				}
			}
			mu.Unlock()
		}
	}()
	buf := make([]byte, 65535)
	for {
		n, from, err := pc.ReadFrom(buf)
		if err != nil {
			time.Sleep(100 * time.Millisecond)
			continue
		}
		key := from.String()
		mu.Lock()
		f := flows[key]
		if f != nil {
			r.mu.Lock()
			alive := r.peers[f.peer.addr.String()] == f.peer
			r.mu.Unlock()
			if !alive {
				delete(flows, key)
				f = nil
			}
		}
		if f == nil {
			p := r.claim()
			if p == nil {
				mu.Unlock()
				s.log("udp %s: no raw tunnel socket available (is the foreign server running?)", fw.Listen)
				continue
			}
			f = &rawFlow{peer: p, pc: pc, client: from, target: fw.Target, last: time.Now()}
			p.mu.Lock()
			p.flow = f
			p.mu.Unlock()
			flows[key] = f
		}
		mu.Unlock()
		r.send(f, buf[:n])
	}
}

// ---------------------------------------------------------------- client

func (c *Client) runRaw() {
	addr, err := rawAddr(c.cfg.Server)
	if err != nil {
		c.log("raw udp: %v", err)
		return
	}
	c.log("raw udp relay to %s, pool=%d", addr, c.cfg.Pool)
	for i := 0; i < c.cfg.Pool; i++ {
		go c.rawWorker(addr)
		time.Sleep(20 * time.Millisecond)
	}
}

// rawWorker keeps one idle socket registered; once a flow claims it, it
// starts its replacement and serves the flow until it goes silent.
func (c *Client) rawWorker(addr string) {
	for {
		if c.rawSocket(addr) {
			go c.rawWorker(addr)
			return
		}
		time.Sleep(2 * time.Second)
	}
}

// rawSocket returns true when the socket carried a flow.
func (c *Client) rawSocket(addr string) bool {
	ua, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		return false
	}
	conn, err := net.DialUDP("udp", nil, ua)
	if err != nil {
		return false
	}
	defer conn.Close()
	rawSockBuf(conn)
	hello := append([]byte{rawHello}, c.cfg.Token...)

	var (
		mu     sync.Mutex
		target net.Conn
	)
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		t := time.NewTicker(rawKeepalive)
		defer t.Stop()
		for {
			conn.Write(hello)
			select {
			case <-stop:
				return
			case <-t.C:
			}
		}
	}()

	buf := make([]byte, 65535)
	for {
		mu.Lock()
		busy := target != nil
		mu.Unlock()
		wait := rawStale
		if busy {
			wait = rawIdle
		}
		conn.SetReadDeadline(time.Now().Add(wait))
		n, err := conn.Read(buf)
		if err != nil {
			mu.Lock()
			if target != nil {
				target.Close()
			}
			mu.Unlock()
			return busy
		}
		var payload []byte
		switch {
		case n >= 2 && buf[0] == rawTarget && n >= 2+int(buf[1]):
			tl := int(buf[1])
			payload = buf[2+tl : n]
			if target == nil {
				t, err := c.dialRawTarget(string(buf[2 : 2+tl]))
				if err != nil {
					c.log("raw udp: %v", err)
					continue
				}
				mu.Lock()
				target = t
				mu.Unlock()
				go func(t net.Conn) {
					out := make([]byte, 65536)
					out[0] = rawData
					for {
						t.SetReadDeadline(time.Now().Add(rawIdle))
						m, err := t.Read(out[1:])
						if err != nil {
							conn.SetReadDeadline(time.Now()) // wake the reader
							return
						}
						conn.Write(out[:1+m])
					}
				}(t)
			}
		case n >= 1 && buf[0] == rawData:
			payload = buf[1:n]
		default:
			continue
		}
		if target != nil {
			target.Write(payload)
		}
	}
}

func (c *Client) dialRawTarget(t string) (net.Conn, error) {
	if host, _, err := net.SplitHostPort(t); err == nil {
		if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || isLocalIP(ip)) {
			return dialLocalUDP(distinctLocalAddr(ip), t)
		}
	}
	if c.cfg.Verbose {
		log.Printf("raw udp session -> %s", t)
	}
	return net.DialTimeout("udp", t, 10*time.Second)
}
