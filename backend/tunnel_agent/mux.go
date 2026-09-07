// Multiplexed transports (tcpmux, wsmux, wssmux)
//
// The plain transports (tcp/tls/ws/wss) open one physical connection per
// forwarded TCP session or UDP flow, taken from a pool of connections the
// foreign server keeps warm (see Client.dataWorker / Server.pool in
// main.go). That is simple and works well, but every simultaneous session
// costs the foreign server one more open socket and one more TLS/WS
// handshake to keep alive.
//
// The mux transports instead keep a small, fixed number of physical
// connections open (config "mux_con", like Backhaul's tcpmux/wsmux/wssmux)
// and multiplex many logical streams over each one: the Iran server asks a
// physical connection to open a new stream (frmMuxOpen), the foreign side
// dials the target and answers (frmMuxOpenOK/Err), and framed chunks flow
// over that stream (frmMuxData) until either side closes it (frmMuxClose).
// Only the server ever opens streams, since it is the side that receives
// public connections in this reverse-tunnel design.
package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

const (
	frmMuxOpen    byte = 6  // streamID(4) + JSON dialReq
	frmMuxOpenOK  byte = 7  // streamID(4)
	frmMuxOpenErr byte = 8  // streamID(4) + error text
	frmMuxData    byte = 9  // streamID(4) + payload
	frmMuxClose   byte = 10 // streamID(4)
)

// maxMuxPayload keeps every frmMuxData frame comfortably under maxFrame
// once the 4-byte stream id is added, and stays clear of any real-world
// UDP datagram (VPN traffic is always far smaller than a link MTU).
const maxMuxPayload = 32 * 1024

func isMuxTransport(t string) bool {
	switch t {
	case "tcpmux", "wsmux", "wssmux":
		return true
	}
	return false
}

func u32(id uint32) []byte {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, id)
	return b
}

// ---------------------------------------------------------------- session

// muxSession runs over one physical tunnel connection (an *fconn, already
// wrapped in TLS/WebSocket as needed by the caller) and carries many
// logical muxStreams.
type muxSession struct {
	f *fconn

	nextID uint32 // server only: allocates stream ids

	smu     sync.Mutex
	streams map[uint32]*muxStream

	pendingMu sync.Mutex
	pending   map[uint32]chan error // server only: outstanding OpenStream calls

	dead int32 // atomic
}

func newMuxSession(f *fconn) *muxSession {
	return &muxSession{
		f:       f,
		streams: make(map[uint32]*muxStream),
		pending: make(map[uint32]chan error),
	}
}

func (ms *muxSession) isClosed() bool { return atomic.LoadInt32(&ms.dead) == 1 }

// serve reads frames off the physical connection until it dies, dispatching
// each one to the right stream (or, on the client, spawning one). isServer
// selects which side of the open handshake this process plays.
func (ms *muxSession) serve(isServer bool, dial func(id uint32, req dialReq)) {
	defer ms.teardown()
	for {
		// Without a read deadline, a physical connection that goes dark
		// without an RST/FIN (a dropped NAT mapping, a sleeping client,
		// a black-holed network path) would sit in serve() forever - the
		// session would never be marked dead, stay in the round-robin
		// pool, and every request routed to it would stall for the full
		// OpenStream timeout. Heartbeat pings every 15s, so a few missed
		// round trips is a reliable dead-peer signal.
		ms.f.SetReadDeadline(time.Now().Add(60 * time.Second))
		t, p, err := ms.f.recv()
		if err != nil {
			return
		}
		switch t {
		case frmPing:
			if ms.f.send(frmPong, nil) != nil {
				return
			}
		case frmPong:
			// liveness only
		case frmMuxOpen:
			if isServer || len(p) < 4 {
				continue
			}
			id := binary.BigEndian.Uint32(p[:4])
			var req dialReq
			if err := json.Unmarshal(p[4:], &req); err != nil {
				continue
			}
			go dial(id, req)
		case frmMuxOpenOK:
			if !isServer || len(p) < 4 {
				continue
			}
			ms.completeOpen(binary.BigEndian.Uint32(p[:4]), nil)
		case frmMuxOpenErr:
			if !isServer || len(p) < 4 {
				continue
			}
			id := binary.BigEndian.Uint32(p[:4])
			ms.completeOpen(id, errors.New(string(p[4:])))
		case frmMuxData:
			if len(p) < 4 {
				continue
			}
			ms.dispatchData(binary.BigEndian.Uint32(p[:4]), p[4:])
		case frmMuxClose:
			if len(p) < 4 {
				continue
			}
			ms.closeStream(binary.BigEndian.Uint32(p[:4]))
		}
	}
}

// heartbeat keeps an otherwise-idle physical connection alive and detects a
// dead peer promptly. Only the server drives it, mirroring Server.handleControl.
func (ms *muxSession) heartbeat() {
	for {
		time.Sleep(15 * time.Second)
		if ms.isClosed() {
			return
		}
		if err := ms.f.send(frmPing, nil); err != nil {
			ms.teardown()
			return
		}
	}
}

func (ms *muxSession) registerStream(id uint32) *muxStream {
	st := &muxStream{ms: ms, id: id, rch: make(chan []byte, 128), closedCh: make(chan struct{})}
	ms.smu.Lock()
	ms.streams[id] = st
	ms.smu.Unlock()
	return st
}

func (ms *muxSession) dropStream(id uint32) {
	ms.smu.Lock()
	delete(ms.streams, id)
	ms.smu.Unlock()
}

// dispatchData and closeStream run only inside serve()'s goroutine, so they
// are the sole (and therefore safe) owners of closing a stream's rch.
func (ms *muxSession) dispatchData(id uint32, payload []byte) {
	ms.smu.Lock()
	st := ms.streams[id]
	ms.smu.Unlock()
	if st == nil {
		return // late data for a stream we already closed locally
	}
	buf := append([]byte(nil), payload...)
	select {
	case st.rch <- buf:
	case <-st.closedCh:
	}
}

func (ms *muxSession) closeStream(id uint32) {
	ms.smu.Lock()
	st := ms.streams[id]
	delete(ms.streams, id)
	ms.smu.Unlock()
	if st != nil {
		close(st.rch)
	}
}

func (ms *muxSession) completeOpen(id uint32, err error) {
	ms.pendingMu.Lock()
	ch := ms.pending[id]
	delete(ms.pending, id)
	ms.pendingMu.Unlock()
	if ch != nil {
		ch <- err
	}
}

func (ms *muxSession) teardown() {
	ms.smu.Lock()
	streams := ms.streams
	ms.streams = nil
	ms.smu.Unlock()
	for _, st := range streams {
		close(st.rch)
	}

	ms.pendingMu.Lock()
	pending := ms.pending
	ms.pending = nil
	ms.pendingMu.Unlock()
	for _, ch := range pending {
		ch <- errors.New("mux session closed")
	}

	atomic.StoreInt32(&ms.dead, 1)
	ms.f.Close()
}

// OpenStream is called by the server to ask the foreign side to dial a
// forward's target over a fresh logical stream on this physical connection.
func (ms *muxSession) OpenStream(netKind, target string) (*muxStream, error) {
	id := atomic.AddUint32(&ms.nextID, 1)
	st := ms.registerStream(id)

	waitCh := make(chan error, 1)
	ms.pendingMu.Lock()
	ms.pending[id] = waitCh
	ms.pendingMu.Unlock()

	req, _ := json.Marshal(dialReq{Net: netKind, Target: target})
	payload := append(u32(id), req...)
	if err := ms.f.send(frmMuxOpen, payload); err != nil {
		ms.pendingMu.Lock()
		delete(ms.pending, id)
		ms.pendingMu.Unlock()
		ms.dropStream(id)
		return nil, err
	}

	select {
	case err := <-waitCh:
		if err != nil {
			ms.dropStream(id)
			return nil, err
		}
		return st, nil
	case <-time.After(20 * time.Second):
		ms.pendingMu.Lock()
		delete(ms.pending, id)
		ms.pendingMu.Unlock()
		ms.dropStream(id)
		return nil, errors.New("mux open timed out")
	}
}

// ---------------------------------------------------------------- stream

// muxStream is one logical, ordered, reliable byte stream carried over a
// muxSession. It implements net.Conn so it drops straight into joinStreams,
// and additionally exposes sendFrame/recvFrame for datagram-shaped use
// (UDP forwarding), where one Write must equal one Read on the far side.
type muxStream struct {
	ms   *muxSession
	id   uint32
	rch  chan []byte
	rbuf []byte

	closedCh  chan struct{}
	closeOnce sync.Once
}

func (s *muxStream) Read(p []byte) (int, error) {
	for len(s.rbuf) == 0 {
		select {
		case b, ok := <-s.rch:
			if !ok {
				return 0, io.EOF
			}
			s.rbuf = b
		case <-s.closedCh:
			return 0, io.ErrClosedPipe
		}
	}
	n := copy(p, s.rbuf)
	s.rbuf = s.rbuf[n:]
	return n, nil
}

func (s *muxStream) Write(p []byte) (int, error) {
	select {
	case <-s.closedCh:
		return 0, io.ErrClosedPipe
	default:
	}
	total := 0
	for len(p) > 0 {
		n := len(p)
		if n > maxMuxPayload {
			n = maxMuxPayload
		}
		if err := s.sendFrame(p[:n]); err != nil {
			return total, err
		}
		total += n
		p = p[n:]
	}
	return total, nil
}

func (s *muxStream) Close() error {
	s.closeOnce.Do(func() {
		close(s.closedCh)
		s.ms.f.send(frmMuxClose, u32(s.id))
		s.ms.dropStream(s.id)
	})
	return nil
}

func (s *muxStream) LocalAddr() net.Addr              { return s.ms.f.LocalAddr() }
func (s *muxStream) RemoteAddr() net.Addr             { return s.ms.f.RemoteAddr() }
func (s *muxStream) SetDeadline(time.Time) error      { return nil }
func (s *muxStream) SetReadDeadline(time.Time) error  { return nil }
func (s *muxStream) SetWriteDeadline(time.Time) error { return nil }

// sendFrame writes exactly one frmMuxData frame - used for UDP forwarding,
// where the frame boundary must equal one datagram.
func (s *muxStream) sendFrame(p []byte) error {
	if len(p) > maxMuxPayload {
		return fmt.Errorf("mux datagram too large: %d bytes", len(p))
	}
	buf := make([]byte, 4+len(p))
	copy(buf, u32(s.id))
	copy(buf[4:], p)
	return s.ms.f.send(frmMuxData, buf)
}

// recvFrame returns the next datagram written by the peer's sendFrame, or
// times out - the mux equivalent of fconn.recv() with a read deadline.
func (s *muxStream) recvFrame(timeout time.Duration) ([]byte, error) {
	select {
	case b, ok := <-s.rch:
		if !ok {
			return nil, io.EOF
		}
		return b, nil
	case <-s.closedCh:
		return nil, io.ErrClosedPipe
	case <-time.After(timeout):
		return nil, errors.New("mux read timeout")
	}
}

// ---------------------------------------------------------------- server side

func (s *Server) handleMux(f *fconn) {
	ms := newMuxSession(f)
	s.muxMu.Lock()
	s.muxSessions = append(s.muxSessions, ms)
	s.muxMu.Unlock()
	s.log("mux client connected from %s", f.RemoteAddr())

	go ms.heartbeat()
	ms.serve(true, nil) // server never receives frmMuxOpen

	s.muxMu.Lock()
	for i, m := range s.muxSessions {
		if m == ms {
			s.muxSessions = append(s.muxSessions[:i], s.muxSessions[i+1:]...)
			break
		}
	}
	s.muxMu.Unlock()
	s.log("mux client %s disconnected", f.RemoteAddr())
}

func (s *Server) pickMuxSession() *muxSession {
	s.muxMu.Lock()
	defer s.muxMu.Unlock()
	live := s.muxSessions[:0]
	for _, m := range s.muxSessions {
		if !m.isClosed() {
			live = append(live, m)
		}
	}
	s.muxSessions = live
	if len(live) == 0 {
		return nil
	}
	s.muxRR = (s.muxRR + 1) % len(live)
	return live[s.muxRR]
}

func (s *Server) openMux(fw Forward) (*muxStream, error) {
	ms := s.pickMuxSession()
	if ms == nil {
		return nil, errors.New("no mux tunnel connection available (is the foreign server running?)")
	}
	return ms.OpenStream(fw.Net, fw.Target)
}

func (s *Server) serveTCPForwardMux(fw Forward) {
	ln, err := net.Listen("tcp", fw.Listen)
	if err != nil {
		s.log("forward %s: %v", fw.Listen, err)
		return
	}
	s.log("forwarding tcp %s -> %s %s", fw.Listen, fw.Target, label(fw))
	for {
		c, err := ln.Accept()
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		go func(c net.Conn) {
			st, err := s.openMux(fw)
			if err != nil {
				s.log("tcp %s: %v", fw.Listen, err)
				c.Close()
				return
			}
			if tc, ok := c.(*net.TCPConn); ok {
				tc.SetNoDelay(true)
			}
			joinStreams(c, c, st, st)
		}(c)
	}
}

type udpMuxSession struct {
	st   *muxStream
	last time.Time
	mu   sync.Mutex
}

func (s *Server) serveUDPForwardMux(fw Forward) {
	pc, err := net.ListenPacket("udp", fw.Listen)
	if err != nil {
		s.log("forward %s: %v", fw.Listen, err)
		return
	}
	s.log("forwarding udp %s -> %s %s", fw.Listen, fw.Target, label(fw))

	var mu sync.Mutex
	sessions := make(map[string]*udpMuxSession)

	go func() {
		for range time.Tick(30 * time.Second) {
			now := time.Now()
			mu.Lock()
			for k, sess := range sessions {
				sess.mu.Lock()
				idle := now.Sub(sess.last)
				sess.mu.Unlock()
				if idle > 90*time.Second {
					sess.st.Close()
					delete(sessions, k)
				}
			}
			mu.Unlock()
		}
	}()

	buf := make([]byte, 65535)
	for {
		n, addr, err := pc.ReadFrom(buf)
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		key := addr.String()
		mu.Lock()
		sess := sessions[key]
		mu.Unlock()

		if sess == nil {
			st, err := s.openMux(fw)
			if err != nil {
				s.log("udp %s: %v", fw.Listen, err)
				continue
			}
			sess = &udpMuxSession{st: st, last: time.Now()}
			mu.Lock()
			sessions[key] = sess
			mu.Unlock()

			go func(sess *udpMuxSession, addr net.Addr, key string) {
				defer func() {
					sess.st.Close()
					mu.Lock()
					// Only remove the entry if it's still this session - a
					// fresh session may already have replaced it under the
					// same key while this goroutine was winding down.
					if sessions[key] == sess {
						delete(sessions, key)
					}
					mu.Unlock()
				}()
				for {
					p, err := sess.st.recvFrame(120 * time.Second)
					if err != nil {
						return
					}
					sess.mu.Lock()
					sess.last = time.Now()
					sess.mu.Unlock()
					if _, err := pc.WriteTo(p, addr); err != nil {
						return
					}
				}
			}(sess, addr, key)
		}

		sess.mu.Lock()
		sess.last = time.Now()
		sess.mu.Unlock()
		if err := sess.st.sendFrame(buf[:n]); err != nil {
			sess.st.Close()
			mu.Lock()
			if sessions[key] == sess {
				delete(sessions, key)
			}
			mu.Unlock()
		}
	}
}

// ---------------------------------------------------------------- client side

func (c *Client) muxWorker() {
	backoff := time.Second
	for {
		f, err := c.connect("mux")
		if err != nil {
			c.log("mux link: %v (retrying in %s)", err, backoff)
			time.Sleep(backoff)
			if backoff < 30*time.Second {
				backoff *= 2
			}
			continue
		}
		c.log("mux link established with %s", c.cfg.Server)
		backoff = time.Second

		ms := newMuxSession(f)
		ms.serve(false, func(id uint32, req dialReq) {
			c.acceptMuxStream(ms, id, req)
		})

		c.log("mux link lost, reconnecting")
		time.Sleep(2 * time.Second)
	}
}

func (c *Client) acceptMuxStream(ms *muxSession, id uint32, req dialReq) {
	st := ms.registerStream(id)
	switch req.Net {
	case "udp":
		c.serveMuxUDP(ms, st, req)
	default:
		c.serveMuxTCP(ms, st, req)
	}
}

func (c *Client) serveMuxTCP(ms *muxSession, st *muxStream, req dialReq) {
	target, err := net.DialTimeout("tcp", req.Target, 10*time.Second)
	if err != nil {
		ms.f.send(frmMuxOpenErr, append(u32(st.id), []byte(err.Error())...))
		ms.dropStream(st.id)
		return
	}
	if tc, ok := target.(*net.TCPConn); ok {
		tc.SetNoDelay(true)
	}
	if err := ms.f.send(frmMuxOpenOK, u32(st.id)); err != nil {
		target.Close()
		ms.dropStream(st.id)
		return
	}
	if c.cfg.Verbose {
		c.log("mux tcp session -> %s", req.Target)
	}
	joinStreams(st, st, target, target)
}

func (c *Client) serveMuxUDP(ms *muxSession, st *muxStream, req dialReq) {
	target, err := net.DialTimeout("udp", req.Target, 10*time.Second)
	if err != nil {
		ms.f.send(frmMuxOpenErr, append(u32(st.id), []byte(err.Error())...))
		ms.dropStream(st.id)
		return
	}
	defer target.Close()
	if err := ms.f.send(frmMuxOpenOK, u32(st.id)); err != nil {
		return
	}
	if c.cfg.Verbose {
		c.log("mux udp session -> %s", req.Target)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 65535)
		for {
			target.SetReadDeadline(time.Now().Add(120 * time.Second))
			n, err := target.Read(buf)
			if err != nil {
				return
			}
			if err := st.sendFrame(buf[:n]); err != nil {
				return
			}
		}
	}()

	for {
		p, err := st.recvFrame(120 * time.Second)
		if err != nil {
			break
		}
		if _, err := target.Write(p); err != nil {
			break
		}
	}
	st.Close()
	<-done
}
