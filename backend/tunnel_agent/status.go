package main

// A loopback-only status endpoint, so something on the same host (the panel's
// node agent) can tell whether this tunnel is actually up instead of guessing
// from an open port. A udp or spoof tunnel has no port a TCP probe can check
// at all, and even for the TCP transports an open port on the Iran side says
// nothing about whether the foreign side is connected to it.
//
// It is bound to 127.0.0.1 and serves only counters, so it needs no auth.

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

const defaultStatusListen = "127.0.0.1:18461"

var tunnelStatus struct {
	links int32 // live control/mux links (client: to the server; server: from clients)

	mu      sync.Mutex
	lastUp  time.Time
	lastErr string
}

func statusLinkUp() {
	atomic.AddInt32(&tunnelStatus.links, 1)
	tunnelStatus.mu.Lock()
	tunnelStatus.lastUp = time.Now()
	tunnelStatus.lastErr = ""
	tunnelStatus.mu.Unlock()
}

func statusLinkDown() { atomic.AddInt32(&tunnelStatus.links, -1) }

func statusLinkError(err error) {
	tunnelStatus.mu.Lock()
	tunnelStatus.lastErr = err.Error()
	tunnelStatus.mu.Unlock()
}

type statusReply struct {
	Mode      string `json:"mode"`
	Transport string `json:"transport"`
	Server    string `json:"server,omitempty"`
	Listen    string `json:"listen,omitempty"`
	Links     int32  `json:"links"`
	LastUp    string `json:"last_up,omitempty"`
	LastError string `json:"last_error,omitempty"`
}

func runStatus(cfg *Config) {
	addr := cfg.StatusListen
	if addr == "" {
		addr = defaultStatusListen
	}
	if addr == "off" {
		return
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		tunnelStatus.mu.Lock()
		rep := statusReply{
			Mode:      cfg.Mode,
			Transport: cfg.Transport,
			Server:    cfg.Server,
			Listen:    cfg.Listen,
			Links:     atomic.LoadInt32(&tunnelStatus.links),
			LastError: tunnelStatus.lastErr,
		}
		if !tunnelStatus.lastUp.IsZero() {
			rep.LastUp = tunnelStatus.lastUp.UTC().Format(time.RFC3339)
		}
		tunnelStatus.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rep)
	})
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	if err := srv.ListenAndServe(); err != nil {
		// Not fatal: the tunnel works without it, the panel just can't see it.
		log.Printf("status endpoint on %s unavailable: %v", addr, err)
	}
}
