// Tifusi Reality Probe: measures, from the admin's own laptop on an Iranian
// operator, how fast each REALITY field-test config really is — above all
// upload, which is what MCI throttles while download stays fine.
//
// The panel already does the server half (node_agent/field_test.py): it opens
// one throwaway REALITY inbound per candidate SNI and hands out a
// subscription link. This program takes that link, dials every config once per
// uTLS fingerprint through an embedded Xray client, and times a delay check, a
// download and an upload for each. Only a client on the operator's own network
// can see the throttling, which is why this runs on the laptop and not on the
// node or in a browser (a browser cannot choose its SNI or TLS fingerprint).
//
// It serves its UI on 127.0.0.1 and opens the browser there; nothing listens on
// any other address.
package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"sync"
	"time"
)

//go:embed index.html
var assets embed.FS

type startRequest struct {
	Sub          string   `json:"sub"`
	Fingerprints []string `json:"fingerprints"`
	UploadMB     int      `json:"upload_mb"`
	DownloadMB   int      `json:"download_mb"`
}

// runner is whatever the page is showing: a manual run (*Job, from a pasted
// subscription) or an automatic one (*Auto, which finds its own targets).
type runner interface {
	Running() bool
	Snapshot() map[string]any
}

var (
	mu     sync.Mutex
	run    runner
	cancel context.CancelFunc
)

func main() {
	ln, err := net.Listen("tcp", "127.0.0.1:18650")
	if err != nil {
		// Already running (the port is taken): just open the page again.
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			log.Fatal(err)
		}
	}
	url := fmt.Sprintf("http://%s/", ln.Addr().String())

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		page, _ := assets.ReadFile("index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(page)
	})
	mux.HandleFunc("/api/start", handleStart)
	mux.HandleFunc("/api/auto", handleAuto)
	mux.HandleFunc("/api/status", handleStatus)
	mux.HandleFunc("/api/stop", handleStop)

	fmt.Println("Tifusi Reality Probe:", url)
	fmt.Println("Keep this window open while testing. Close it to quit.")
	go openBrowser(url)
	log.Fatal(http.Serve(ln, localOnly(mux)))
}

// localOnly refuses requests whose Host is not the loopback address, so a web
// page elsewhere cannot drive the probe through DNS rebinding.
func localOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			host = r.Host
		}
		if host != "127.0.0.1" && host != "localhost" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func openBrowser(url string) {
	time.Sleep(300 * time.Millisecond)
	switch runtime.GOOS {
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		exec.Command("open", url).Start()
	default:
		exec.Command("xdg-open", url).Start()
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func handleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req startRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "bad request"})
		return
	}
	req.UploadMB = clamp(req.UploadMB, 1, 50, 5)
	req.DownloadMB = clamp(req.DownloadMB, 1, 50, 2)
	fps := validFingerprints(req.Fingerprints)
	if len(fps) == 0 {
		writeJSON(w, 400, map[string]string{"error": "یک Fingerprint انتخاب کن"})
		return
	}

	configs, err := fetchSubscription(req.Sub)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}

	mu.Lock()
	defer mu.Unlock()
	if run != nil && run.Running() {
		writeJSON(w, 409, map[string]string{"error": "یک تست در حال اجراست"})
		return
	}
	ctx, c := context.WithCancel(context.Background())
	cancel = c
	job := NewJob(configs, fps, req.UploadMB, req.DownloadMB)
	run = job
	go job.Run(ctx)
	writeJSON(w, 200, job.Snapshot())
}

func handleAuto(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req autoRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "bad request"})
		return
	}
	req.UploadMB = clamp(req.UploadMB, 1, 50, 5)
	req.DownloadMB = clamp(req.DownloadMB, 1, 50, 2)
	req.Count = clamp(req.Count, 100, 3000, 1000)
	req.Top = clamp(req.Top, 1, 12, 10)
	fps := validFingerprints(req.Fingerprints)
	if len(fps) == 0 {
		writeJSON(w, 400, map[string]string{"error": "یک Fingerprint انتخاب کن"})
		return
	}
	if _, err := newPanel(req.Panel, req.Key); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}

	mu.Lock()
	defer mu.Unlock()
	if run != nil && run.Running() {
		writeJSON(w, 409, map[string]string{"error": "یک تست در حال اجراست"})
		return
	}
	ctx, c := context.WithCancel(context.Background())
	cancel = c
	a := &Auto{Phase: "panel", started: time.Now()}
	run = a
	go a.Run(ctx, req, fps)
	writeJSON(w, 200, a.Snapshot())
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	j := run
	mu.Unlock()
	if j == nil {
		writeJSON(w, 200, map[string]any{"state": "idle"})
		return
	}
	writeJSON(w, 200, j.Snapshot())
}

func handleStop(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	if cancel != nil {
		cancel()
	}
	j := run
	mu.Unlock()
	if j == nil {
		writeJSON(w, 200, map[string]any{"state": "idle"})
		return
	}
	writeJSON(w, 200, j.Snapshot())
}

func clamp(v, lo, hi, def int) int {
	if v == 0 {
		return def
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

var knownFingerprints = []string{"chrome", "firefox", "safari", "edge", "ios", "android", "360", "qq", "randomized"}

func validFingerprints(in []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, fp := range in {
		for _, k := range knownFingerprints {
			if fp == k && !seen[fp] {
				out = append(out, fp)
				seen[fp] = true
			}
		}
	}
	return out
}

var errNoConfigs = errors.New("هیچ کانفیگ REALITY در این لینک پیدا نشد")
