package main

// Transport fallback for mux tunnels.
//
// A route that works today can start dropping one transport tomorrow (a
// port gets blocked, TLS to an address gets reset, UDP gets throttled). With
// "fallback" set, the server listens on every listed carrier as well as its
// primary one, and the client moves down the list when the carrier it is on
// keeps failing, then periodically checks whether the primary is back.
//
// Every carrier speaks the mux role, whatever its transport is called, so
// the server's forwards and mux session pool are shared by all of them: a
// client can sit on any mix of carriers at once and traffic still flows.

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"time"

	kcp "github.com/xtaci/kcp-go/v5"
)

// Carrier is one way to reach the tunnel server.
type Carrier struct {
	Transport string `json:"transport"`        // tcp | tls | ws | wss | tcpmux | wsmux | wssmux | udp
	Listen    string `json:"listen,omitempty"` // server: where this carrier listens
	Server    string `json:"server,omitempty"` // client: ip:port to dial for it
	SNI       string `json:"sni,omitempty"`    // defaults to the top-level sni
	Path      string `json:"path,omitempty"`   // defaults to the top-level path
}

const (
	// Consecutive failed or short-lived links on a carrier before moving on.
	fallbackFailLimit = 4
	// How often, while on a fallback carrier, the primary is re-checked.
	fallbackRecheck = 5 * time.Minute
)

func isTLSTransport(t string) bool {
	return t == "tls" || t == "wss" || t == "wssmux"
}

func isWSTransport(t string) bool {
	return t == "ws" || t == "wss" || t == "wsmux" || t == "wssmux"
}

func (c *Config) primaryCarrier() Carrier {
	return Carrier{Transport: c.Transport, Listen: c.Listen, Server: c.Server, SNI: c.SNI, Path: c.Path}
}

func (c *Config) hasUDPFallback() bool {
	for _, f := range c.Fallback {
		if f.Transport == "udp" {
			return true
		}
	}
	return false
}

func (c *Config) validateFallback() error {
	if len(c.Fallback) == 0 {
		return nil
	}
	if !isMuxTransport(c.Transport) || c.Transport == "spoof" {
		return errors.New("fallback needs a mux primary transport (tcpmux, wsmux or wssmux)")
	}
	for i, f := range c.Fallback {
		switch f.Transport {
		case "tcp", "tls", "ws", "wss", "tcpmux", "wsmux", "wssmux", "udp":
		default:
			return fmt.Errorf("fallback[%d]: transport must be tcp, tls, ws, wss, tcpmux, wsmux, wssmux or udp, got %q", i, f.Transport)
		}
		if c.Mode == "server" && f.Listen == "" {
			return fmt.Errorf("fallback[%d]: server mode needs \"listen\"", i)
		}
		if c.Mode == "client" && f.Server == "" {
			return fmt.Errorf("fallback[%d]: client mode needs \"server\"", i)
		}
	}
	return nil
}

// ---------------------------------------------------------------- server side

// listenCarrier opens the listener for a TCP- or KCP-based carrier. primary
// selects whether the top-level Let's Encrypt domain applies to it.
func (s *Server) listenCarrier(car Carrier, primary bool) (net.Listener, error) {
	if car.Transport == "udp" {
		block, err := newKCPBlock(s.cfg.Token)
		if err != nil {
			return nil, fmt.Errorf("udp crypto: %w", err)
		}
		kln, err := kcp.ListenWithOptions(car.Listen, block, s.cfg.FECData, s.cfg.FECParity)
		if err != nil {
			return nil, fmt.Errorf("cannot listen on %s: %w", car.Listen, err)
		}
		return kln, nil
	}
	rawLn, err := net.Listen("tcp", car.Listen)
	if err != nil {
		return nil, fmt.Errorf("cannot listen on %s: %w", car.Listen, err)
	}
	ln := net.Listener(nodelayListener{rawLn})
	if isTLSTransport(car.Transport) {
		if primary && s.cfg.Domain != "" {
			s.log("requesting a real certificate from Let's Encrypt for %s", s.cfg.Domain)
			return tls.NewListener(ln, acmeTLSConfig(s.cfg.Domain)), nil
		}
		tc, err := tlsServerConfig(car.SNI)
		if err != nil {
			rawLn.Close()
			return nil, err
		}
		return tls.NewListener(ln, tc), nil
	}
	return ln, nil
}

func (s *Server) startFallbackListeners() {
	for _, car := range s.cfg.Fallback {
		car := car
		ln, err := s.listenCarrier(car, false)
		if err != nil {
			s.log("fallback %s: %v", car.Transport, err)
			continue
		}
		s.log("fallback listening on %s (%s)", car.Listen, car.Transport)
		go func() {
			if err := s.acceptLoop(ln, car); err != nil {
				s.log("fallback %s on %s stopped: %v", car.Transport, car.Listen, err)
			}
		}()
	}
}

// ---------------------------------------------------------------- client side

type fallbackState struct {
	carriers []Carrier
	cur      int32 // atomic index into carriers
	fails    int32 // atomic: consecutive failures on cur
	switched int64 // atomic unix nanos of the last move off the primary
	mu       sync.Mutex
}

func (c *Client) startFallback() {
	if len(c.cfg.Fallback) == 0 {
		return
	}
	c.fb.carriers = append([]Carrier{c.cfg.primaryCarrier()}, c.cfg.Fallback...)
	go c.recheckPrimary()
}

func (c *Client) currentCarrier() (Carrier, int) {
	if len(c.fb.carriers) == 0 {
		return c.cfg.primaryCarrier(), 0
	}
	i := int(atomic.LoadInt32(&c.fb.cur))
	return c.fb.carriers[i], i
}

func (c *Client) linkTarget() string {
	car, i := c.currentCarrier()
	if i == 0 {
		return c.target()
	}
	return fmt.Sprintf("%s (fallback %s)", car.Server, car.Transport)
}

func (c *Client) noteLinkUp() {
	atomic.StoreInt32(&c.fb.fails, 0)
}

// noteLinkFailure counts a failed or short-lived link on the current carrier
// and moves to the next one once the limit is reached.
func (c *Client) noteLinkFailure() {
	if len(c.fb.carriers) < 2 {
		return
	}
	if atomic.AddInt32(&c.fb.fails, 1) < fallbackFailLimit {
		return
	}
	c.fb.mu.Lock()
	defer c.fb.mu.Unlock()
	if atomic.LoadInt32(&c.fb.fails) < fallbackFailLimit {
		return // another worker already moved on
	}
	next := (atomic.LoadInt32(&c.fb.cur) + 1) % int32(len(c.fb.carriers))
	atomic.StoreInt32(&c.fb.cur, next)
	atomic.StoreInt32(&c.fb.fails, 0)
	atomic.StoreInt64(&c.fb.switched, time.Now().UnixNano())
	car := c.fb.carriers[next]
	server := car.Server
	if next == 0 {
		server = c.target()
	}
	c.log("fallback: switching to %s via %s", car.Transport, server)
}

// recheckPrimary returns to the primary carrier once it accepts a handshake
// again, so a temporary outage doesn't leave the tunnel on a slower fallback.
func (c *Client) recheckPrimary() {
	for range time.Tick(fallbackRecheck) {
		if atomic.LoadInt32(&c.fb.cur) == 0 {
			continue
		}
		f, err := c.connectTo(c.cfg.Server, "probe")
		if err != nil {
			continue
		}
		f.Close()
		c.fb.mu.Lock()
		atomic.StoreInt32(&c.fb.cur, 0)
		atomic.StoreInt32(&c.fb.fails, 0)
		c.fb.mu.Unlock()
		c.log("fallback: primary %s is reachable again, switching back", c.cfg.Transport)
	}
}
