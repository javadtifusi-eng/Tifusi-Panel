// Tifusi Tunnel - reverse tunnel engine
//
// Topology:
//
//	VPN user ──► Iran VPS (mode: server, exposes public ports)
//	                 ▲
//	                 │  tunnel connections are dialed OUT by the foreign VPS
//	                 │
//	             Foreign VPS (mode: client) ──► 127.0.0.1:<vpn service port>
//
// The foreign server never needs an open inbound port, and the Iran server
// never needs to reach the foreign IP directly.
package main

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/crypto/acme/autocert"

	kcp "github.com/xtaci/kcp-go/v5"
)

const version = "1.0.0"

const (
	ansiReset = "\033[0m"
	ansiBold  = "\033[1m"
	ansiCyan  = "\033[96m"
	ansiDim   = "\033[90m"
	ansiBlue  = "\033[94m"
)

// printBanner draws a small boxed header for interactive/log output -
// width is computed so centering always lines up, unlike a hand-drawn
// ASCII art block that has to be re-measured by hand every time the
// text changes.
func printBanner(ver, mode, transport string) {
	const bw = 50
	frame := ansiBlue + ansiBold
	rule := strings.Repeat("═", bw)
	line := func(text, color string) {
		pad := bw - len([]rune(text))
		if pad < 0 {
			pad = 0
		}
		left := pad / 2
		fmt.Printf("  %s║%s%s%s%s%s%s║%s\n",
			frame, ansiReset,
			strings.Repeat(" ", left), color+ansiBold, text, ansiReset,
			strings.Repeat(" ", pad-left), frame+ansiReset)
	}
	fmt.Println()
	fmt.Printf("  %s╔%s╗%s\n", frame, rule, ansiReset)
	line("", "")
	line("TIFUSI TUNNEL", ansiCyan)
	line("reverse tunnel · client-initiated", ansiDim)
	line("", "")
	fmt.Printf("  %s╚%s╝%s\n", frame, rule, ansiReset)
	fmt.Println()
	fmt.Printf("  %s%s%s  mode: %s%s%s  transport: %s%s%s\n\n",
		ansiBold, ver, ansiReset, ansiCyan, mode, ansiReset, ansiCyan, transport, ansiReset)
}

// ---------------------------------------------------------------- config

type Forward struct {
	Name   string `json:"name,omitempty"`
	Listen string `json:"listen"` // public address on the Iran server, e.g. 0.0.0.0:1194
	Net    string `json:"net"`    // tcp | udp
	Target string `json:"target"` // resolved ON THE FOREIGN SERVER, e.g. 127.0.0.1:1194
}

// PanelConfig turns on the optional web admin panel, served over its own
// HTTPS listener (self-signed, like the "tls" transport) by the same
// process. It is off unless explicitly enabled with a username and a
// bcrypt password hash - see "-panel-hash" in main().
type PanelConfig struct {
	Enabled      bool   `json:"enabled"`
	Listen       string `json:"listen"` // e.g. 0.0.0.0:9443
	Username     string `json:"username"`
	PasswordHash string `json:"password_hash"` // bcrypt, from -panel-hash
}

type Config struct {
	Mode      string       `json:"mode"`      // server | client
	Listen    string       `json:"listen"`    // server only: tunnel listen address
	Server    string       `json:"server"`    // client only: iran_ip:tunnel_port
	Transport string       `json:"transport"` // tcp | tls | ws | wss | tcpmux | wsmux | wssmux | udp
	Token     string       `json:"token"`
	SNI       string       `json:"sni"`     // TLS server name / certificate CN
	Path      string       `json:"path"`    // HTTP path used by ws/wss/wsmux/wssmux
	Pool      int          `json:"pool"`    // client only: idle tunnel connections kept warm (non-mux transports)
	MuxCon    int          `json:"mux_con"` // client only: physical connections kept open (mux transports)
	Forwards  []Forward    `json:"forwards"`
	Verbose   bool         `json:"verbose"`
	Panel     *PanelConfig `json:"panel,omitempty"`
	// Domain, server only: when set, a tls/wss/wssmux listener requests a
	// real certificate from Let's Encrypt for this domain (via ACME
	// HTTP-01, needs port 80 reachable) instead of generating a
	// self-signed one. SNI should match this domain in that case.
	Domain string `json:"domain,omitempty"`
}

func (c *Config) applyDefaults() {
	if c.Transport == "" {
		c.Transport = "tls"
	}
	if c.SNI == "" {
		c.SNI = "www.bing.com"
	}
	if c.Path == "" {
		c.Path = "/tunnel"
	}
	if c.Pool <= 0 {
		c.Pool = 8
	}
	if c.MuxCon <= 0 {
		c.MuxCon = 8
	}
	for i := range c.Forwards {
		if c.Forwards[i].Net == "" {
			c.Forwards[i].Net = "tcp"
		}
	}
	if c.Panel != nil && c.Panel.Listen == "" {
		c.Panel.Listen = "0.0.0.0:9443"
	}
}

func (c *Config) validate() error {
	switch c.Mode {
	case "server":
		if c.Listen == "" {
			return errors.New("server mode needs \"listen\"")
		}
		if len(c.Forwards) == 0 {
			return errors.New("server mode needs at least one entry in \"forwards\"")
		}
	case "client":
		if c.Server == "" {
			return errors.New("client mode needs \"server\"")
		}
	default:
		return fmt.Errorf("mode must be \"server\" or \"client\", got %q", c.Mode)
	}
	switch c.Transport {
	case "tcp", "tls", "ws", "wss", "tcpmux", "wsmux", "wssmux", "udp":
	default:
		return fmt.Errorf("transport must be tcp, tls, ws, wss, tcpmux, wsmux, wssmux or udp, got %q", c.Transport)
	}
	if len(c.Token) < 8 {
		return errors.New("token must be at least 8 characters")
	}
	if c.Panel != nil && c.Panel.Enabled {
		if c.Panel.Username == "" || c.Panel.PasswordHash == "" {
			return errors.New("panel.enabled needs a username and password_hash")
		}
	}
	return nil
}

func loadConfig(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, fmt.Errorf("invalid JSON in %s: %w", path, err)
	}
	c.applyDefaults()
	if err := c.validate(); err != nil {
		return nil, err
	}
	return &c, nil
}

// ---------------------------------------------------------------- framing

const (
	frmPing    byte = 0
	frmPong    byte = 1
	frmDial    byte = 2
	frmDialOK  byte = 3
	frmDialErr byte = 4
	frmUDP     byte = 5
)

const maxFrame = 65535

// fconn is a tunnel connection that speaks length-prefixed frames.
// Writes are serialised so several goroutines may send on the same link.
type fconn struct {
	net.Conn
	br  *bufio.Reader
	wmu sync.Mutex
}

func newFconn(c net.Conn) *fconn {
	return &fconn{Conn: c, br: bufio.NewReaderSize(c, 32*1024)}
}

func (f *fconn) send(t byte, payload []byte) error {
	if len(payload) > maxFrame {
		return errors.New("frame too large")
	}
	buf := make([]byte, 3+len(payload))
	buf[0] = t
	buf[1] = byte(len(payload) >> 8)
	buf[2] = byte(len(payload))
	copy(buf[3:], payload)
	f.wmu.Lock()
	defer f.wmu.Unlock()
	_, err := f.Conn.Write(buf)
	return err
}

func (f *fconn) recv() (byte, []byte, error) {
	var hdr [3]byte
	if _, err := io.ReadFull(f.br, hdr[:]); err != nil {
		return 0, nil, err
	}
	n := int(hdr[1])<<8 | int(hdr[2])
	if n == 0 {
		return hdr[0], nil, nil
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(f.br, buf); err != nil {
		return 0, nil, err
	}
	return hdr[0], buf, nil
}

type dialReq struct {
	Net    string `json:"net"`
	Target string `json:"target"`
}

type hello struct {
	Ver   string `json:"ver"`
	Token string `json:"token"`
	Role  string `json:"role"` // control | data
}

type helloReply struct {
	OK  bool   `json:"ok"`
	Err string `json:"err,omitempty"`
}

// ---------------------------------------------------------------- transport

func tlsServerConfig(sni string) (*tls.Config, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, err
	}
	tmpl := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: sni, Organization: []string{"Cloud Services"}},
		DNSNames:              []string{sni},
		NotBefore:             time.Now().Add(-24 * time.Hour),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IsCA:                  true,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}},
		MinVersion:   tls.VersionTLS12,
		NextProtos:   []string{"http/1.1"},
	}, nil
}

// acmeTLSConfig requests a real certificate from Let's Encrypt for domain
// instead of generating a self-signed one - a real cert holds up far
// better against active probing (a DPI system that actually connects and
// inspects what comes back) than a self-signed one with a fake SNI.
//
// Uses ACME HTTP-01, which needs port 80 reachable from the internet -
// deliberately not TLS-ALPN-01, since that challenge type always probes
// port 443 specifically regardless of which port the tunnel itself is
// configured on, so it wouldn't work with e.g. the default 8443. The
// HTTP-01 listener is best-effort: if port 80 is already taken, this logs
// and keeps going rather than failing tunnel startup, since the initial
// certificate (or a cached one from a prior run) may still be usable.
func acmeTLSConfig(domain string) *tls.Config {
	m := &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist(domain),
		Cache:      autocert.DirCache("/etc/tifusi/certs"),
	}
	go func() {
		if err := http.ListenAndServe(":80", m.HTTPHandler(nil)); err != nil {
			log.Printf("acme: http-01 challenge listener on :80 failed: %v (cert issuance/renewal may fail without it)", err)
		}
	}()
	return m.TLSConfig()
}

// tuneKCP configures a KCP session for the "udp" transport: fast mode (no
// Nagle-style delay, aggressive retransmit), a generous window so the
// multi-connection pool doesn't stall on one slow link, and stream mode so
// Read/Write behave like a plain byte stream instead of preserving message
// boundaries - required since fconn's framing already does that itself.
func tuneKCP(sess *kcp.UDPSession) {
	sess.SetStreamMode(true)
	sess.SetWriteDelay(false)
	sess.SetNoDelay(1, 10, 2, 1)
	sess.SetWindowSize(1024, 1024)
	sess.SetMtu(1350)
	sess.SetACKNoDelay(true)
}

// wsKey/wsAccept keep the handshake byte-identical to a real WebSocket upgrade.
func wsAccept(key string) string {
	h := sha1.New()
	io.WriteString(h, key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

func clientUpgrade(c net.Conn, br *bufio.Reader, host, path string) error {
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return err
	}
	key := base64.StdEncoding.EncodeToString(nonce[:])
	req := "GET " + path + " HTTP/1.1\r\n" +
		"Host: " + host + "\r\n" +
		"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n" +
		"Connection: Upgrade\r\n" +
		"Upgrade: websocket\r\n" +
		"Sec-WebSocket-Version: 13\r\n" +
		"Sec-WebSocket-Key: " + key + "\r\n\r\n"
	if _, err := c.Write([]byte(req)); err != nil {
		return err
	}
	resp, err := http.ReadResponse(br, nil)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		return fmt.Errorf("upgrade refused: %s", resp.Status)
	}
	return nil
}

func serverUpgrade(c net.Conn, br *bufio.Reader, path string) error {
	req, err := http.ReadRequest(br)
	if err != nil {
		return err
	}
	if req.URL.Path != path {
		c.Write([]byte("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"))
		return fmt.Errorf("unexpected path %q", req.URL.Path)
	}
	key := req.Header.Get("Sec-WebSocket-Key")
	resp := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + wsAccept(key) + "\r\n\r\n"
	_, err = c.Write([]byte(resp))
	return err
}

// ---------------------------------------------------------------- real WebSocket framing (RFC 6455)
//
// The handshake above matches a real WebSocket upgrade byte-for-byte, but
// until here the data that followed it was a raw, unframed stream - not
// something a real WebSocket-aware intermediary (nginx, a CDN) could relay.
// wsConn fixes that: every fconn.send() becomes exactly one WebSocket
// binary frame, and reads transparently reassemble frames (including
// fragmented ones) back into a byte stream, replying to pings automatically.
// Per RFC 6455, frames a client sends MUST be masked; frames a server sends
// MUST NOT be - wsConn tracks which side it is and does the right thing.

const (
	wsOpContinuation = 0x0
	wsOpText         = 0x1
	wsOpBinary       = 0x2
	wsOpClose        = 0x8
	wsOpPing         = 0x9
	wsOpPong         = 0xA
	wsMaxFrame       = 8 * 1024 * 1024 // guard against a hostile/broken peer
)

func wsWriteFrame(w io.Writer, isClient bool, opcode byte, payload []byte) error {
	n := len(payload)
	head := []byte{0x80 | opcode} // FIN=1, no fragmentation on send

	var maskBit byte
	if isClient {
		maskBit = 0x80
	}
	switch {
	case n <= 125:
		head = append(head, maskBit|byte(n))
	case n <= 65535:
		ext := make([]byte, 2)
		binary.BigEndian.PutUint16(ext, uint16(n))
		head = append(head, maskBit|126)
		head = append(head, ext...)
	default:
		ext := make([]byte, 8)
		binary.BigEndian.PutUint64(ext, uint64(n))
		head = append(head, maskBit|127)
		head = append(head, ext...)
	}

	buf := make([]byte, 0, len(head)+4+n)
	buf = append(buf, head...)
	if isClient {
		var mask [4]byte
		if _, err := rand.Read(mask[:]); err != nil {
			return err
		}
		buf = append(buf, mask[:]...)
		masked := make([]byte, n)
		for i := 0; i < n; i++ {
			masked[i] = payload[i] ^ mask[i%4]
		}
		buf = append(buf, masked...)
	} else {
		buf = append(buf, payload...)
	}
	_, err := w.Write(buf)
	return err
}

// wsReadFrame reads exactly one WebSocket frame from br.
func wsReadFrame(br *bufio.Reader) (fin bool, opcode byte, payload []byte, err error) {
	var hdr [2]byte
	if _, err = io.ReadFull(br, hdr[:]); err != nil {
		return
	}
	fin = hdr[0]&0x80 != 0
	opcode = hdr[0] & 0x0F
	masked := hdr[1]&0x80 != 0
	length := uint64(hdr[1] & 0x7F)

	switch length {
	case 126:
		var ext [2]byte
		if _, err = io.ReadFull(br, ext[:]); err != nil {
			return
		}
		length = uint64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err = io.ReadFull(br, ext[:]); err != nil {
			return
		}
		length = binary.BigEndian.Uint64(ext[:])
	}
	if length > wsMaxFrame {
		err = fmt.Errorf("websocket frame too large: %d bytes", length)
		return
	}

	var maskKey [4]byte
	if masked {
		if _, err = io.ReadFull(br, maskKey[:]); err != nil {
			return
		}
	}
	payload = make([]byte, length)
	if _, err = io.ReadFull(br, payload); err != nil {
		return
	}
	if masked {
		for i := range payload {
			payload[i] ^= maskKey[i%4]
		}
	}
	return
}

// wsConn turns an already-upgraded connection into a real WebSocket byte
// stream: Write sends one binary frame per call, Read reassembles frames
// (including fragmented ones) and answers pings without the caller ever
// seeing control frames.
type wsConn struct {
	net.Conn
	isClient bool
	br       *bufio.Reader // continues from wherever the HTTP upgrade parser left off
	rbuf     []byte
	wmu      sync.Mutex
}

func newWsConn(c net.Conn, br *bufio.Reader, isClient bool) *wsConn {
	return &wsConn{Conn: c, br: br, isClient: isClient}
}

func (w *wsConn) Write(p []byte) (int, error) {
	w.wmu.Lock()
	defer w.wmu.Unlock()
	if err := wsWriteFrame(w.Conn, w.isClient, wsOpBinary, p); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (w *wsConn) writeControl(opcode byte, payload []byte) error {
	w.wmu.Lock()
	defer w.wmu.Unlock()
	return wsWriteFrame(w.Conn, w.isClient, opcode, payload)
}

func (w *wsConn) Read(p []byte) (int, error) {
	for len(w.rbuf) == 0 {
		msg, err := w.readMessage()
		if err != nil {
			return 0, err
		}
		w.rbuf = msg
	}
	n := copy(p, w.rbuf)
	w.rbuf = w.rbuf[n:]
	return n, nil
}

// readMessage reads frames until a complete data message (handling
// fragmentation) is assembled, transparently answering pings and treating
// pongs and a close frame appropriately.
func (w *wsConn) readMessage() ([]byte, error) {
	var assembled []byte
	for {
		fin, opcode, payload, err := wsReadFrame(w.br)
		if err != nil {
			return nil, err
		}
		switch opcode {
		case wsOpClose:
			return nil, io.EOF
		case wsOpPing:
			if err := w.writeControl(wsOpPong, payload); err != nil {
				return nil, err
			}
			continue
		case wsOpPong:
			continue
		case wsOpContinuation, wsOpText, wsOpBinary:
			assembled = append(assembled, payload...)
			if fin {
				return assembled, nil
			}
			continue
		default:
			continue // ignore reserved/unsupported opcodes
		}
	}
}

// ---------------------------------------------------------------- helpers

// closeWriter is implemented by connections that support a TCP-style half
// close (*net.TCPConn, *tls.Conn); ws/mux connections don't, and joinStreams
// falls back to waiting for both directions instead of closing early.
type closeWriter interface {
	CloseWrite() error
}

// joinStreams pipes a<-brd and b<-ar concurrently. Each direction signals
// EOF to its own destination as soon as its source is done (a proper TCP
// half close on connections that support it, e.g. plain tcp/tls - a client
// that half-closes after sending its request still sees the full response,
// instead of having it cut off the instant its own side goes quiet). The
// ws/mux transports have no equivalent mid-session half-close signal, so
// once one direction finishes the other gets a bounded grace period to
// finish naturally before both sides are closed - long enough for a normal
// reply, short enough not to leak a session forever on one that never will.
func joinStreams(a net.Conn, ar io.Reader, b net.Conn, brd io.Reader) {
	done := make(chan struct{}, 2)
	go func() {
		io.Copy(a, brd)
		if cw, ok := a.(closeWriter); ok {
			cw.CloseWrite()
		}
		done <- struct{}{}
	}()
	go func() {
		io.Copy(b, ar)
		if cw, ok := b.(closeWriter); ok {
			cw.CloseWrite()
		}
		done <- struct{}{}
	}()
	<-done
	select {
	case <-done:
	case <-time.After(15 * time.Second):
	}
	a.Close()
	b.Close()
}

func genToken() string {
	var b [16]byte
	rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// isLocalIP reports whether ip belongs to one of this machine's own
// network interfaces (as opposed to a genuinely remote host).
func isLocalIP(ip net.IP) bool {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return false
	}
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok && ipn.IP.Equal(ip) {
			return true
		}
	}
	return false
}

// distinctLocalAddr picks a source address different from target for a
// self-dial (see handleUDP). A real, non-loopback interface address is
// preferred when one is available - some kernel-processed protocols
// (IPsec/XFRM in particular) can fail to deliver return traffic that was
// generated and re-encrypted entirely on the loopback interface, even
// once source and destination addresses no longer collide. Falling back
// to a second loopback address keeps this working on boxes with only
// 127.0.0.1 configured.
func distinctLocalAddr(target net.IP) net.IP {
	if ifaces, err := net.Interfaces(); err == nil {
		for _, ifi := range ifaces {
			// Point-to-point interfaces (tun/wg/ppp/veth...) route their
			// own address as both source and destination for a lot of
			// traffic and are exactly the kind of ambiguity this is
			// trying to avoid - stick to broadcast-capable interfaces
			// (a real NIC, or a dummy interface set up for this purpose).
			if ifi.Flags&net.FlagBroadcast == 0 || ifi.Flags&net.FlagUp == 0 {
				continue
			}
			addrs, err := ifi.Addrs()
			if err != nil {
				continue
			}
			for _, a := range addrs {
				ipn, ok := a.(*net.IPNet)
				if !ok || ipn.IP.To4() == nil || ipn.IP.IsLoopback() || ipn.IP.Equal(target) {
					continue
				}
				return ipn.IP
			}
		}
	}
	if target.Equal(net.ParseIP("127.0.0.1")) {
		return net.ParseIP("127.0.0.2")
	}
	return net.ParseIP("127.0.0.1")
}

func hostOf(addr string) string {
	h, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return h
}

// ---------------------------------------------------------------- server

type dataConn struct {
	f     *fconn
	mu    sync.Mutex
	dead  bool
	inUse bool
}

type Server struct {
	cfg      *Config
	pool     chan *dataConn
	controls int64
	mu       sync.Mutex

	muxMu       sync.Mutex
	muxSessions []*muxSession
	muxRR       int
}

func (s *Server) log(format string, v ...interface{}) { log.Printf(format, v...) }

// nodelayListener sets TCP_NODELAY on every accepted connection before it is
// (optionally) wrapped in TLS, so the setting applies to all transports -
// once wrapped in a *tls.Conn there is no public way to reach the underlying
// socket to set this after the fact.
type nodelayListener struct{ net.Listener }

func (l nodelayListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	if tc, ok := c.(*net.TCPConn); ok {
		tc.SetNoDelay(true)
		// Without this, a peer that goes dark without an RST/FIN (a dropped
		// NAT mapping, a sleeping client) never surfaces as a socket error
		// on this side - the client already enables keepalive for the
		// connections it dials, so accepted connections get the same
		// dead-peer detection instead of only relying on the tunnel's own
		// application-level ping/pong.
		tc.SetKeepAlive(true)
		tc.SetKeepAlivePeriod(30 * time.Second)
	}
	return c, nil
}

func (s *Server) Run() error {
	var ln net.Listener
	if s.cfg.Transport == "udp" {
		kln, err := kcp.ListenWithOptions(s.cfg.Listen, nil, 0, 0)
		if err != nil {
			return fmt.Errorf("cannot listen on %s: %w", s.cfg.Listen, err)
		}
		ln = kln
	} else {
		rawLn, err := net.Listen("tcp", s.cfg.Listen)
		if err != nil {
			return fmt.Errorf("cannot listen on %s: %w", s.cfg.Listen, err)
		}
		ln = net.Listener(nodelayListener{rawLn})
		if s.cfg.Transport == "tls" || s.cfg.Transport == "wss" || s.cfg.Transport == "wssmux" {
			var tc *tls.Config
			if s.cfg.Domain != "" {
				tc = acmeTLSConfig(s.cfg.Domain)
				s.log("requesting a real certificate from Let's Encrypt for %s", s.cfg.Domain)
			} else {
				var err error
				tc, err = tlsServerConfig(s.cfg.SNI)
				if err != nil {
					return err
				}
			}
			ln = tls.NewListener(ln, tc)
		}
	}
	s.log("tunnel listening on %s (%s)", s.cfg.Listen, s.cfg.Transport)

	mux := isMuxTransport(s.cfg.Transport)
	for _, fw := range s.cfg.Forwards {
		fw := fw
		switch {
		case fw.Net == "tcp" && mux:
			go s.serveTCPForwardMux(fw)
		case fw.Net == "tcp":
			go s.serveTCPForward(fw)
		case fw.Net == "udp" && mux:
			go s.serveUDPForwardMux(fw)
		case fw.Net == "udp":
			go s.serveUDPForward(fw)
		default:
			s.log("skipping forward %s: unknown net %q", fw.Listen, fw.Net)
		}
	}

	for {
		c, err := ln.Accept()
		if err != nil {
			if ne, ok := err.(net.Error); ok && ne.Temporary() {
				time.Sleep(200 * time.Millisecond)
				continue
			}
			return err
		}
		if sess, ok := c.(*kcp.UDPSession); ok {
			tuneKCP(sess)
		}
		go s.acceptTunnel(c)
	}
}

func (s *Server) acceptTunnel(raw net.Conn) {
	raw.SetDeadline(time.Now().Add(20 * time.Second))
	br := bufio.NewReaderSize(raw, 32*1024)
	var conn net.Conn = raw

	if s.cfg.Transport == "ws" || s.cfg.Transport == "wss" || s.cfg.Transport == "wsmux" || s.cfg.Transport == "wssmux" {
		if err := serverUpgrade(raw, br, s.cfg.Path); err != nil {
			if s.cfg.Verbose {
				s.log("handshake from %s failed: %v", raw.RemoteAddr(), err)
			}
			raw.Close()
			return
		}
		// Everything from here on is real WebSocket framing, not a raw
		// stream - this is what lets the tunnel sit behind a WS-aware
		// reverse proxy or CDN instead of only a passthrough TCP proxy.
		conn = newWsConn(raw, br, false) // server frames must NOT be masked
		br = bufio.NewReaderSize(conn, 32*1024)
	}
	f := &fconn{Conn: conn, br: br}

	line, err := f.br.ReadString('\n')
	if err != nil || len(line) > 4096 {
		raw.Close()
		return
	}
	var h hello
	if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &h); err != nil {
		raw.Close()
		return
	}
	if subtle.ConstantTimeCompare([]byte(h.Token), []byte(s.cfg.Token)) != 1 {
		s.log("rejected %s: bad token", raw.RemoteAddr())
		writeJSONLine(conn, helloReply{OK: false, Err: "bad token"})
		raw.Close()
		return
	}
	if err := writeJSONLine(conn, helloReply{OK: true}); err != nil {
		raw.Close()
		return
	}
	raw.SetDeadline(time.Time{})

	switch h.Role {
	case "control":
		s.handleControl(f)
	case "data":
		s.parkData(f)
	case "mux":
		s.handleMux(f)
	default:
		raw.Close()
	}
}

func writeJSONLine(w io.Writer, v interface{}) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = w.Write(append(b, '\n'))
	return err
}

func (s *Server) handleControl(f *fconn) {
	s.mu.Lock()
	s.controls++
	n := s.controls
	s.mu.Unlock()
	s.log("client connected from %s (active control links: %d)", f.RemoteAddr(), n)

	defer func() {
		f.Close()
		s.mu.Lock()
		s.controls--
		n := s.controls
		s.mu.Unlock()
		s.log("client %s disconnected (active control links: %d)", f.RemoteAddr(), n)
	}()

	for {
		if err := f.send(frmPing, nil); err != nil {
			return
		}
		f.SetReadDeadline(time.Now().Add(30 * time.Second))
		if _, _, err := f.recv(); err != nil {
			return
		}
		f.SetReadDeadline(time.Time{})
		time.Sleep(15 * time.Second)
	}
}

// parkData puts an idle tunnel connection into the pool and keeps it alive
// until a forwarded session claims it.
func (s *Server) parkData(f *fconn) {
	d := &dataConn{f: f}
	select {
	case s.pool <- d:
	default:
		f.Close() // pool is full, client is over-provisioning
		return
	}
	go s.keepAlive(d)
}

func (s *Server) keepAlive(d *dataConn) {
	for {
		time.Sleep(20 * time.Second)
		if !d.mu.TryLock() {
			continue // busy: a session is using it
		}
		if d.dead || d.inUse {
			d.mu.Unlock()
			return
		}
		err := func() error {
			if err := d.f.send(frmPing, nil); err != nil {
				return err
			}
			d.f.SetReadDeadline(time.Now().Add(15 * time.Second))
			defer d.f.SetReadDeadline(time.Time{})
			t, _, err := d.f.recv()
			if err != nil {
				return err
			}
			if t != frmPong {
				return errors.New("unexpected frame")
			}
			return nil
		}()
		if err != nil {
			d.dead = true
			d.f.Close()
			d.mu.Unlock()
			return
		}
		d.mu.Unlock()
	}
}

// claim pulls a healthy idle connection out of the pool.
func (s *Server) claim() *dataConn {
	deadline := time.After(12 * time.Second)
	for {
		select {
		case d := <-s.pool:
			d.mu.Lock()
			if d.dead {
				d.mu.Unlock()
				continue
			}
			d.inUse = true
			d.mu.Unlock()
			return d
		case <-deadline:
			return nil
		}
	}
}

// open claims a connection and asks the far side to dial the target.
func (s *Server) open(fw Forward) (*fconn, error) {
	d := s.claim()
	if d == nil {
		return nil, errors.New("no tunnel connection available (is the foreign server running?)")
	}
	req, _ := json.Marshal(dialReq{Net: fw.Net, Target: fw.Target})
	if err := d.f.send(frmDial, req); err != nil {
		d.f.Close()
		return nil, err
	}
	d.f.SetReadDeadline(time.Now().Add(20 * time.Second))
	t, p, err := d.f.recv()
	d.f.SetReadDeadline(time.Time{})
	if err != nil {
		d.f.Close()
		return nil, err
	}
	if t != frmDialOK {
		d.f.Close()
		return nil, fmt.Errorf("far side could not reach %s: %s", fw.Target, string(p))
	}
	return d.f, nil
}

func (s *Server) serveTCPForward(fw Forward) {
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
			f, err := s.open(fw)
			if err != nil {
				s.log("tcp %s: %v", fw.Listen, err)
				c.Close()
				return
			}
			if tc, ok := c.(*net.TCPConn); ok {
				tc.SetNoDelay(true)
			}
			joinStreams(c, c, f.Conn, f.br)
		}(c)
	}
}

type udpSession struct {
	f    *fconn
	last time.Time
	mu   sync.Mutex
}

func (s *Server) serveUDPForward(fw Forward) {
	pc, err := net.ListenPacket("udp", fw.Listen)
	if err != nil {
		s.log("forward %s: %v", fw.Listen, err)
		return
	}
	s.log("forwarding udp %s -> %s %s", fw.Listen, fw.Target, label(fw))

	var mu sync.Mutex
	sessions := make(map[string]*udpSession)

	// reap idle sessions
	go func() {
		for range time.Tick(30 * time.Second) {
			now := time.Now()
			mu.Lock()
			for k, sess := range sessions {
				sess.mu.Lock()
				idle := now.Sub(sess.last)
				sess.mu.Unlock()
				if idle > 90*time.Second {
					sess.f.Close()
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
			f, err := s.open(fw)
			if err != nil {
				s.log("udp %s: %v", fw.Listen, err)
				continue
			}
			sess = &udpSession{f: f, last: time.Now()}
			mu.Lock()
			sessions[key] = sess
			mu.Unlock()

			go func(sess *udpSession, addr net.Addr, key string) {
				defer func() {
					sess.f.Close()
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
					sess.f.SetReadDeadline(time.Now().Add(120 * time.Second))
					t, p, err := sess.f.recv()
					if err != nil {
						return
					}
					if t != frmUDP {
						continue
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
		if err := sess.f.send(frmUDP, buf[:n]); err != nil {
			sess.f.Close()
			mu.Lock()
			if sessions[key] == sess {
				delete(sessions, key)
			}
			mu.Unlock()
		}
	}
}

func label(fw Forward) string {
	if fw.Name == "" {
		return ""
	}
	return "(" + fw.Name + ")"
}

// ---------------------------------------------------------------- client

type Client struct {
	cfg *Config
}

func (c *Client) log(format string, v ...interface{}) { log.Printf(format, v...) }

func (c *Client) Run() error {
	if isMuxTransport(c.cfg.Transport) {
		c.log("connecting to %s (%s), mux_con=%d", c.cfg.Server, c.cfg.Transport, c.cfg.MuxCon)
		for i := 0; i < c.cfg.MuxCon; i++ {
			go c.muxWorker()
			time.Sleep(50 * time.Millisecond)
		}
		select {} // run until the service is stopped
	}
	c.log("connecting to %s (%s), pool=%d", c.cfg.Server, c.cfg.Transport, c.cfg.Pool)
	go c.controlLoop()
	for i := 0; i < c.cfg.Pool; i++ {
		go c.dataWorker()
		time.Sleep(50 * time.Millisecond)
	}
	select {} // run until the service is stopped
}

func (c *Client) connect(role string) (*fconn, error) {
	var raw net.Conn
	if c.cfg.Transport == "udp" {
		sess, err := kcp.DialWithOptions(c.cfg.Server, nil, 0, 0)
		if err != nil {
			return nil, err
		}
		tuneKCP(sess)
		raw = sess
	} else {
		tconn, err := net.DialTimeout("tcp", c.cfg.Server, 15*time.Second)
		if err != nil {
			return nil, err
		}
		if tc, ok := tconn.(*net.TCPConn); ok {
			tc.SetKeepAlive(true)
			tc.SetKeepAlivePeriod(30 * time.Second)
			tc.SetNoDelay(true)
		}
		raw = tconn
	}
	raw.SetDeadline(time.Now().Add(20 * time.Second))

	if c.cfg.Transport == "tls" || c.cfg.Transport == "wss" || c.cfg.Transport == "wssmux" {
		tconn := tls.Client(raw, &tls.Config{
			ServerName: c.cfg.SNI,
			// the tunnel is authenticated by the shared token; the certificate
			// on the Iran side is self-signed on every start
			InsecureSkipVerify: true,
			MinVersion:         tls.VersionTLS12,
		})
		if err := tconn.Handshake(); err != nil {
			raw.Close()
			return nil, err
		}
		raw = tconn
	}

	br := bufio.NewReaderSize(raw, 32*1024)
	var conn net.Conn = raw

	if c.cfg.Transport == "ws" || c.cfg.Transport == "wss" || c.cfg.Transport == "wsmux" || c.cfg.Transport == "wssmux" {
		if err := clientUpgrade(raw, br, c.cfg.SNI, c.cfg.Path); err != nil {
			raw.Close()
			return nil, err
		}
		// Everything from here on is real WebSocket framing, not a raw
		// stream - this is what lets the tunnel sit behind a WS-aware
		// reverse proxy or CDN instead of only a passthrough TCP proxy.
		conn = newWsConn(raw, br, true) // client frames MUST be masked
		br = bufio.NewReaderSize(conn, 32*1024)
	}
	f := &fconn{Conn: conn, br: br}

	if err := writeJSONLine(conn, hello{Ver: version, Token: c.cfg.Token, Role: role}); err != nil {
		raw.Close()
		return nil, err
	}
	line, err := f.br.ReadString('\n')
	if err != nil {
		raw.Close()
		return nil, err
	}
	var rep helloReply
	if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &rep); err != nil || !rep.OK {
		raw.Close()
		if rep.Err != "" {
			return nil, errors.New(rep.Err)
		}
		return nil, errors.New("handshake rejected")
	}
	raw.SetDeadline(time.Time{})
	return f, nil
}

func (c *Client) controlLoop() {
	backoff := time.Second
	for {
		f, err := c.connect("control")
		if err != nil {
			c.log("control link: %v (retrying in %s)", err, backoff)
			time.Sleep(backoff)
			if backoff < 30*time.Second {
				backoff *= 2
			}
			continue
		}
		c.log("control link established with %s", c.cfg.Server)
		backoff = time.Second
		for {
			f.SetReadDeadline(time.Now().Add(60 * time.Second))
			t, _, err := f.recv()
			if err != nil {
				break
			}
			if t == frmPing {
				if err := f.send(frmPong, nil); err != nil {
					break
				}
			}
		}
		f.Close()
		c.log("control link lost, reconnecting")
		time.Sleep(2 * time.Second)
	}
}

// dataWorker keeps exactly one idle tunnel connection warm. As soon as that
// connection is claimed for a session it spawns a replacement and then serves
// the session to completion.
func (c *Client) dataWorker() {
	backoff := time.Second
	for {
		f, err := c.connect("data")
		if err != nil {
			time.Sleep(backoff)
			if backoff < 20*time.Second {
				backoff *= 2
			}
			continue
		}
		backoff = time.Second
		claimed := c.serveIdle(f)
		f.Close()
		if claimed {
			return // a replacement worker was already started
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// serveIdle returns true when the connection was claimed for a real session.
func (c *Client) serveIdle(f *fconn) bool {
	for {
		f.SetReadDeadline(time.Now().Add(90 * time.Second))
		t, p, err := f.recv()
		if err != nil {
			return false
		}
		f.SetReadDeadline(time.Time{})
		switch t {
		case frmPing:
			if err := f.send(frmPong, nil); err != nil {
				return false
			}
		case frmDial:
			go c.dataWorker() // keep the pool at full strength
			c.handleDial(f, p)
			return true
		default:
			return false
		}
	}
}

func (c *Client) handleDial(f *fconn, payload []byte) {
	var req dialReq
	if err := json.Unmarshal(payload, &req); err != nil {
		f.send(frmDialErr, []byte("bad request"))
		return
	}
	switch req.Net {
	case "udp":
		c.handleUDP(f, req)
	default:
		c.handleTCP(f, req)
	}
}

func (c *Client) handleTCP(f *fconn, req dialReq) {
	target, err := net.DialTimeout("tcp", req.Target, 10*time.Second)
	if err != nil {
		f.send(frmDialErr, []byte(err.Error()))
		return
	}
	if tc, ok := target.(*net.TCPConn); ok {
		tc.SetNoDelay(true)
	}
	if err := f.send(frmDialOK, nil); err != nil {
		target.Close()
		return
	}
	if c.cfg.Verbose {
		c.log("tcp session -> %s", req.Target)
	}
	joinStreams(f.Conn, f.br, target, target)
}

func (c *Client) handleUDP(f *fconn, req dialReq) {
	d := &net.Dialer{Timeout: 10 * time.Second}
	// For a target that is this same box (the common case: forwarding to
	// a service running locally), let the OS pick the source address as
	// usual UNLESS it would end up identical to the destination - the
	// kernel then treats the flow as fully self-addressed, which breaks
	// delivery of return traffic for kernel-processed protocols like
	// IPsec/XFRM (e.g. an L2TP/IPsec server bound locally: replies
	// generated after ESP decryption never make it back out). Binding to
	// 127.0.0.1 as source (or 127.0.0.2 if the target itself is
	// 127.0.0.1) avoids that ambiguity, whether the target is a loopback
	// address or one of this machine's own real interface addresses -
	// without touching genuinely remote forwards.
	if host, _, err := net.SplitHostPort(req.Target); err == nil {
		if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || isLocalIP(ip)) {
			d.LocalAddr = &net.UDPAddr{IP: distinctLocalAddr(ip)}
		}
	}
	target, err := d.Dial("udp", req.Target)
	if err != nil {
		f.send(frmDialErr, []byte(err.Error()))
		return
	}
	defer target.Close()
	if err := f.send(frmDialOK, nil); err != nil {
		return
	}
	if c.cfg.Verbose {
		c.log("udp session -> %s", req.Target)
	}

	done := make(chan struct{})

	// target -> tunnel
	go func() {
		defer close(done)
		buf := make([]byte, 65535)
		for {
			target.SetReadDeadline(time.Now().Add(120 * time.Second))
			n, err := target.Read(buf)
			if err != nil {
				return
			}
			if err := f.send(frmUDP, buf[:n]); err != nil {
				return
			}
		}
	}()

	// tunnel -> target
loop:
	for {
		f.SetReadDeadline(time.Now().Add(120 * time.Second))
		t, p, err := f.recv()
		if err != nil {
			break
		}
		switch t {
		case frmUDP:
			if _, err := target.Write(p); err != nil {
				break loop
			}
		case frmPing:
			f.send(frmPong, nil)
		}
	}
	target.Close()
	<-done
}

// ---------------------------------------------------------------- main

func main() {
	log.SetFlags(log.Ldate | log.Ltime)

	cfgPath := flag.String("config", "/etc/tifusi/config.json", "path to the configuration file")
	showVersion := flag.Bool("version", false, "print version and exit")
	token := flag.Bool("gen-token", false, "print a fresh random token and exit")
	check := flag.Bool("check", false, "validate the configuration and exit")
	panelHash := flag.String("panel-hash", "", "print a bcrypt hash of this password for the web panel and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("tifusi %s\n", version)
		return
	}
	if *token {
		fmt.Println(genToken())
		return
	}
	if *panelHash != "" {
		hash, err := hashPanelPassword(*panelHash)
		if err != nil {
			log.Fatalf("panel-hash: %v", err)
		}
		fmt.Println(hash)
		return
	}

	cfg, err := loadConfig(*cfgPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if *check {
		fmt.Println("configuration OK")
		return
	}

	printBanner(version, cfg.Mode, cfg.Transport)

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		log.Println("shutting down")
		os.Exit(0)
	}()

	if cfg.Panel != nil && cfg.Panel.Enabled {
		go runPanel(cfg, *cfgPath)
	}

	if cfg.Mode == "server" {
		s := &Server{cfg: cfg, pool: make(chan *dataConn, 512)}
		log.Fatal(s.Run())
	}
	cl := &Client{cfg: cfg}
	// A friendly reminder: the client resolves targets locally.
	if hostOf(cfg.Server) == "127.0.0.1" {
		log.Println("warning: \"server\" points at localhost; it should be the Iran server's public IP")
	}
	log.Fatal(cl.Run())
}
