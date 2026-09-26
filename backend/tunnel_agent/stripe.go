package main

// Striped UDP forwarding over mux transports.
//
// Some Iranian datacenters shape international traffic per TCP connection
// (~1 MB/s each) while the server as a whole gets several times that. A UDP
// forward used to pin each client address to one mux stream, and so to one
// physical connection, capping every VPN user at that per-connection rate.
// A striped forward instead opens one stream per physical connection for the
// same client, all tagged with a shared group id, and spreads datagrams
// across them. The foreign side joins the group's streams onto a single UDP
// socket so the target (e.g. strongSwan) still sees one peer.
//
// Streams have different latencies, so datagrams arrive out of order. Each
// one carries an 8-byte sequence number and the receiving end puts them
// back in order before delivery: IPsec's anti-replay window (32 packets by
// default, and not configurable on most clients) drops anything reordered
// further than that.

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"net"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

const (
	// A gap in the sequence is waited on this long before it is skipped.
	// Physical connections are reliable TCP, so a gap only ever means a
	// slower sibling connection (or a dead one) - never a lost packet.
	reorderWait = 40 * time.Millisecond
	// Out-of-order datagrams held at most; beyond it the gap is skipped.
	reorderMax = 4096
)

func newGroupID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// ---------------------------------------------------------------- reorder

// reorderer restores sequence order for one direction of a striped flow and
// calls deliver for each datagram, from its own goroutine only.
type reorderer struct {
	mu      sync.Mutex
	next    uint64
	started bool
	held    map[uint64][]byte
	timer   *time.Timer
	deliver func([]byte)
}

func newReorderer(deliver func([]byte)) *reorderer {
	return &reorderer{held: make(map[uint64][]byte), deliver: deliver}
}

func (r *reorderer) push(seq uint64, p []byte) {
	r.mu.Lock()
	var out [][]byte
	if !r.started {
		r.started = true
		r.next = seq
	}
	switch {
	case seq < r.next:
		// Arrived after its gap was skipped: still hand it on, the target
		// protocol decides what to do with a late packet.
		out = append(out, p)
	case seq == r.next:
		out = append(out, p)
		r.next++
		out = r.drainLocked(out)
	default:
		r.held[seq] = p
		if len(r.held) > reorderMax {
			out = r.skipLocked(out)
		}
	}
	r.armLocked()
	// Delivered under the lock so concurrent pushers can't interleave.
	for _, b := range out {
		r.deliver(b)
	}
	r.mu.Unlock()
}

func (r *reorderer) drainLocked(out [][]byte) [][]byte {
	for {
		b, ok := r.held[r.next]
		if !ok {
			return out
		}
		delete(r.held, r.next)
		out = append(out, b)
		r.next++
	}
}

// skipLocked jumps next to the lowest held sequence and drains from there.
func (r *reorderer) skipLocked(out [][]byte) [][]byte {
	if len(r.held) == 0 {
		return out
	}
	keys := make([]uint64, 0, len(r.held))
	for k := range r.held {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	r.next = keys[0]
	return r.drainLocked(out)
}

func (r *reorderer) armLocked() {
	if len(r.held) == 0 {
		if r.timer != nil {
			r.timer.Stop()
		}
		return
	}
	if r.timer == nil {
		r.timer = time.AfterFunc(reorderWait, r.onTimeout)
		return
	}
	r.timer.Reset(reorderWait)
}

func (r *reorderer) onTimeout() {
	r.mu.Lock()
	out := r.skipLocked(nil)
	r.armLocked()
	for _, b := range out {
		r.deliver(b)
	}
	r.mu.Unlock()
}

func (r *reorderer) stop() {
	r.mu.Lock()
	if r.timer != nil {
		r.timer.Stop()
	}
	r.mu.Unlock()
}

// ---------------------------------------------------------------- stripe

// stripe is the sending half shared by both ends: a set of streams that
// datagrams are spread across round-robin, each prefixed with a sequence.
type stripe struct {
	mu      sync.Mutex
	streams []*muxStream
	rr      int
	seq     uint64 // atomic
}

func (s *stripe) add(st *muxStream) {
	s.mu.Lock()
	s.streams = append(s.streams, st)
	s.mu.Unlock()
}

// remove drops st and reports how many streams are left.
func (s *stripe) remove(st *muxStream) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, x := range s.streams {
		if x == st {
			s.streams = append(s.streams[:i], s.streams[i+1:]...)
			break
		}
	}
	return len(s.streams)
}

func (s *stripe) closeAll() {
	s.mu.Lock()
	streams := s.streams
	s.streams = nil
	s.mu.Unlock()
	for _, st := range streams {
		st.Close()
	}
}

// send writes one datagram on the next stream, moving past any that fail.
// It reports false once no stream is left to carry it.
func (s *stripe) send(p []byte) bool {
	if len(p)+8 > maxMuxPayload {
		return true // not a real VPN datagram; drop it, keep the flow
	}
	buf := make([]byte, 8+len(p))
	binary.BigEndian.PutUint64(buf, atomic.AddUint64(&s.seq, 1))
	copy(buf[8:], p)
	for {
		s.mu.Lock()
		if len(s.streams) == 0 {
			s.mu.Unlock()
			return false
		}
		s.rr = (s.rr + 1) % len(s.streams)
		st := s.streams[s.rr]
		s.mu.Unlock()
		if err := st.sendFrame(buf); err == nil {
			return true
		}
		st.Close()
		s.remove(st)
	}
}

func splitSeq(p []byte) (uint64, []byte, bool) {
	if len(p) < 8 {
		return 0, nil, false
	}
	return binary.BigEndian.Uint64(p), p[8:], true
}

// ---------------------------------------------------------------- server side

func (s *Server) liveMuxSessions() []*muxSession {
	s.muxMu.Lock()
	defer s.muxMu.Unlock()
	var live []*muxSession
	for _, m := range s.muxSessions {
		if !m.isClosed() {
			live = append(live, m)
		}
	}
	return live
}

type udpStripeSession struct {
	st   stripe
	ro   *reorderer
	last int64 // atomic unix nanos
	done chan struct{}
	once sync.Once
}

func (u *udpStripeSession) touch() { atomic.StoreInt64(&u.last, time.Now().UnixNano()) }

func (u *udpStripeSession) close() {
	u.once.Do(func() {
		close(u.done)
		u.st.closeAll()
		u.ro.stop()
	})
}

func (s *Server) serveUDPForwardStripe(fw Forward) {
	pc, err := net.ListenPacket("udp", fw.Listen)
	if err != nil {
		s.log("forward %s: %v", fw.Listen, err)
		return
	}
	s.log("forwarding udp %s -> %s %s (striped)", fw.Listen, fw.Target, label(fw))

	var mu sync.Mutex
	sessions := make(map[string]*udpStripeSession)
	drop := func(key string, u *udpStripeSession) {
		u.close()
		mu.Lock()
		if sessions[key] == u {
			delete(sessions, key)
		}
		mu.Unlock()
	}

	go func() {
		for range time.Tick(30 * time.Second) {
			cutoff := time.Now().Add(-90 * time.Second).UnixNano()
			mu.Lock()
			var idle []string
			for k, u := range sessions {
				if atomic.LoadInt64(&u.last) < cutoff {
					idle = append(idle, k)
				}
			}
			mu.Unlock()
			for _, k := range idle {
				mu.Lock()
				u := sessions[k]
				mu.Unlock()
				if u != nil {
					drop(k, u)
				}
			}
		}
	}()

	// attach opens one group stream on ms and pumps what it receives into
	// the session's reorderer until it ends.
	attach := func(key string, u *udpStripeSession, ms *muxSession, group string) bool {
		st, err := ms.openStreamReq(dialReq{Net: fw.Net, Target: fw.Target, Group: group})
		if err != nil {
			return false
		}
		select {
		case <-u.done:
			st.Close()
			return false
		default:
		}
		u.st.add(st)
		go func() {
			for {
				p, err := st.recvFrame(120 * time.Second)
				if err != nil {
					break
				}
				if seq, b, ok := splitSeq(p); ok {
					u.touch()
					u.ro.push(seq, b)
				}
			}
			st.Close()
			if u.st.remove(st) == 0 {
				drop(key, u)
			}
		}()
		return true
	}

	buf := make([]byte, 65535)
	for {
		n, addr, err := pc.ReadFrom(buf)
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		key := addr.String()
		mu.Lock()
		u := sessions[key]
		mu.Unlock()

		if u == nil {
			live := s.liveMuxSessions()
			if len(live) == 0 {
				s.log("udp %s: no mux tunnel connection available", fw.Listen)
				continue
			}
			u = &udpStripeSession{done: make(chan struct{})}
			u.touch()
			a := addr
			u.ro = newReorderer(func(b []byte) { pc.WriteTo(b, a) })
			group := newGroupID()
			// The first stream is opened inline so this datagram has a
			// carrier; the rest join in the background as they confirm.
			first := s.pickMuxSession()
			if first == nil || !attach(key, u, first, group) {
				u.close()
				s.log("udp %s: could not open tunnel stream", fw.Listen)
				continue
			}
			mu.Lock()
			sessions[key] = u
			mu.Unlock()
			for _, ms := range live {
				if ms != first {
					go attach(key, u, ms, group)
				}
			}
		}

		u.touch()
		if !u.st.send(buf[:n]) {
			drop(key, u)
		}
	}
}

// ---------------------------------------------------------------- client side

func dialUDPTarget(target string) (net.Conn, error) {
	return net.DialTimeout("udp", target, 10*time.Second)
}

// udpGroup is the foreign side of one striped flow: every stream in the
// group feeds the same UDP socket to the target, and replies from it are
// striped back across the group's streams.
type udpGroup struct {
	conn net.Conn
	st   stripe
	ro   *reorderer
}

var (
	udpGroupsMu sync.Mutex
	udpGroups   = map[string]*udpGroup{}
)

func (c *Client) serveMuxUDPGroup(ms *muxSession, st *muxStream, req dialReq) {
	udpGroupsMu.Lock()
	g := udpGroups[req.Group]
	if g == nil {
		target, err := dialUDPTarget(req.Target)
		if err != nil {
			udpGroupsMu.Unlock()
			ms.f.send(frmMuxOpenErr, append(u32(st.id), []byte(err.Error())...))
			ms.dropStream(st.id)
			return
		}
		g = &udpGroup{conn: target}
		g.ro = newReorderer(func(b []byte) { target.Write(b) })
		udpGroups[req.Group] = g
		go c.pumpUDPGroup(req.Group, g)
		if c.cfg.Verbose {
			c.log("mux udp group %s -> %s", req.Group, req.Target)
		}
	}
	g.st.add(st)
	udpGroupsMu.Unlock()

	if err := ms.f.send(frmMuxOpenOK, u32(st.id)); err != nil {
		c.leaveUDPGroup(req.Group, g, st)
		return
	}
	for {
		p, err := st.recvFrame(120 * time.Second)
		if err != nil {
			break
		}
		if seq, b, ok := splitSeq(p); ok {
			g.ro.push(seq, b)
		}
	}
	c.leaveUDPGroup(req.Group, g, st)
}

func (c *Client) leaveUDPGroup(id string, g *udpGroup, st *muxStream) {
	st.Close()
	udpGroupsMu.Lock()
	left := g.st.remove(st)
	if left == 0 && udpGroups[id] == g {
		delete(udpGroups, id)
	}
	udpGroupsMu.Unlock()
	if left == 0 {
		g.conn.Close()
		g.ro.stop()
	}
}

// pumpUDPGroup carries the target's replies back, striped across the group.
func (c *Client) pumpUDPGroup(id string, g *udpGroup) {
	buf := make([]byte, 65535)
	for {
		g.conn.SetReadDeadline(time.Now().Add(120 * time.Second))
		n, err := g.conn.Read(buf)
		if err != nil {
			return
		}
		g.st.send(buf[:n])
	}
}
