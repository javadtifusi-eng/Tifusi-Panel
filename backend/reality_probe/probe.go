package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"os"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	xnet "github.com/xtls/xray-core/common/net"
	"github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/infra/conf/serial"
	_ "github.com/xtls/xray-core/main/distro/all"
)

// Fetched through the tunnel, so they are reached from the node's side: the
// only leg that can be slow is the one between this laptop and the node.
const (
	delayURL    = "https://www.gstatic.com/generate_204"
	downloadURL = "https://speed.cloudflare.com/__down?bytes="
	uploadURL   = "https://speed.cloudflare.com/__up"
)

const (
	delayTimeout    = 10 * time.Second
	downloadTimeout = 15 * time.Second
	// Upload gets longer than download: on a throttled SNI it is the slow
	// direction, and cutting it short would only measure the first burst.
	uploadTimeout = 25 * time.Second
)

type Result struct {
	Config      Config `json:"config"`
	Fingerprint string `json:"fingerprint"`
	State       string `json:"state"` // waiting | testing | done | failed
	Step        string `json:"step,omitempty"`
	DelayMs     int    `json:"delay_ms,omitempty"`
	DownBps     int64  `json:"down_bps,omitempty"`
	UpBps       int64  `json:"up_bps,omitempty"`
	// Set when the transfer hit its time limit rather than finishing: the rate
	// is still right, but it is the rate of a throttled link.
	UpCapped   bool   `json:"up_capped,omitempty"`
	DownCapped bool   `json:"down_capped,omitempty"`
	Error      string `json:"error,omitempty"`
	Detail     string `json:"detail,omitempty"`
	Link       string `json:"link"`
}

type Job struct {
	mu        sync.Mutex
	state     string
	results   []*Result
	uploadMB  int
	downMB    int
	started   time.Time
	finished  time.Time
	usedBytes int64
}

func NewJob(configs []Config, fps []string, upMB, downMB int) *Job {
	j := &Job{state: "running", uploadMB: upMB, downMB: downMB, started: time.Now()}
	// Every SNI with the first fingerprint, then every SNI with the next: a
	// stopped run still covers every SNI rather than a few in depth.
	for _, fp := range fps {
		for _, c := range configs {
			j.results = append(j.results, &Result{Config: c, Fingerprint: fp, State: "waiting", Link: withFingerprint(c.Link, fp)})
		}
	}
	return j
}

func (j *Job) Running() bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.state == "running"
}

func (j *Job) Snapshot() map[string]any {
	j.mu.Lock()
	defer j.mu.Unlock()
	rows := make([]Result, len(j.results))
	done := 0
	for i, r := range j.results {
		rows[i] = *r
		if r.State == "done" || r.State == "failed" {
			done++
		}
	}
	sort.SliceStable(rows, func(a, b int) bool { return better(rows[a], rows[b]) })
	out := map[string]any{
		"state": j.state, "total": len(rows), "done": done, "results": rows,
		"started_at": j.started.Unix(), "used_mb": float64(atomic.LoadInt64(&j.usedBytes)) / 1e6,
	}
	if !j.finished.IsZero() {
		out["finished_at"] = j.finished.Unix()
	}
	return out
}

// better ranks by upload first — the direction MCI throttles — then download,
// then delay. Untested and failed rows sink.
func better(a, b Result) bool {
	rank := func(r Result) int {
		switch r.State {
		case "done":
			return 0
		case "testing":
			return 1
		case "waiting":
			return 2
		}
		return 3
	}
	if rank(a) != rank(b) {
		return rank(a) < rank(b)
	}
	if a.UpBps != b.UpBps {
		return a.UpBps > b.UpBps
	}
	if a.DownBps != b.DownBps {
		return a.DownBps > b.DownBps
	}
	return a.DelayMs < b.DelayMs
}

func (j *Job) update(r *Result, f func(*Result)) {
	j.mu.Lock()
	f(r)
	j.mu.Unlock()
}

func (j *Job) Run(ctx context.Context) {
	for _, r := range j.results {
		if ctx.Err() != nil {
			break
		}
		j.update(r, func(r *Result) { r.State, r.Step = "testing", "connect" })
		err := j.test(ctx, r)
		j.update(r, func(r *Result) {
			r.Step = ""
			if err != nil {
				r.State, r.Error, r.Detail = "failed", headline(err), short(err)
			} else {
				r.State = "done"
			}
		})
	}
	j.mu.Lock()
	for _, r := range j.results {
		if r.State == "waiting" || r.State == "testing" {
			r.State, r.Error = "failed", "متوقف شد"
		}
	}
	j.state, j.finished = "done", time.Now()
	j.mu.Unlock()
}

// stepError keeps the Persian headline for the table apart from the raw
// cause, which only goes in the tooltip.
type stepError struct {
	headline string
	cause    error
}

func (e stepError) Error() string { return e.headline + ": " + e.cause.Error() }
func (e stepError) Unwrap() error { return e.cause }

func headline(err error) string {
	var se stepError
	if errors.As(err, &se) {
		return se.headline
	}
	return "خطا"
}

func short(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	s := err.Error()
	if len(s) > 140 {
		s = s[:140]
	}
	return s
}

// test brings up a private Xray client for one config and fingerprint and
// measures through it. Nothing listens: requests are dialled straight into
// the instance, so tests cannot collide on a port.
func (j *Job) test(ctx context.Context, r *Result) error {
	inst, err := startXray(r.Config, r.Fingerprint)
	if err != nil {
		return stepError{"کانفیگ نامعتبر", err}
	}
	defer inst.Close()
	client := tunnelClient(inst, &j.usedBytes)
	defer client.CloseIdleConnections()

	// The first request through a fresh instance pays for the REALITY
	// handshake and warms everything up; it is not timed, but if it fails the
	// SNI does not work on this network at all.
	if _, err := timedGet(ctx, client, delayURL, delayTimeout); err != nil {
		return stepError{"وصل نشد", err}
	}
	var delays []int
	for i := 0; i < 3; i++ {
		if ms, err := timedGet(ctx, client, delayURL, delayTimeout); err == nil {
			delays = append(delays, ms)
		}
	}
	if len(delays) == 0 {
		return stepError{"اتصال ناپایدار", errors.New("delay checks failed after the first request")}
	}
	sort.Ints(delays)
	j.update(r, func(r *Result) { r.DelayMs, r.Step = delays[len(delays)/2], "download" })

	down, capped, err := download(ctx, client, int64(j.downMB)*1_000_000)
	if err != nil {
		return stepError{"دانلود نشد", err}
	}
	j.update(r, func(r *Result) { r.DownBps, r.DownCapped, r.Step = down, capped, "upload" })

	up, capped, err := upload(ctx, client, int64(j.uploadMB)*1_000_000)
	if err != nil {
		return stepError{"اپلود نشد", err}
	}
	j.update(r, func(r *Result) { r.UpBps, r.UpCapped = up, capped })
	return nil
}

// PROBE_DEBUG=1 shows Xray's own log in the console window, for when a
// config fails and the reason is not obvious from the table.
var xrayLogLevel = func() string {
	if os.Getenv("PROBE_DEBUG") != "" {
		return "debug"
	}
	return "none"
}()

func startXray(c Config, fp string) (*core.Instance, error) {
	user := map[string]any{"id": c.UUID, "encryption": "none"}
	if c.Flow != "" && c.Network == "tcp" {
		user["flow"] = c.Flow
	}
	stream := map[string]any{
		"network":  c.Network,
		"security": "reality",
		"realitySettings": map[string]any{
			"serverName": c.SNI, "fingerprint": fp, "publicKey": c.PublicKey, "shortId": c.ShortID,
		},
	}
	if c.Network == "xhttp" {
		mode := c.Mode
		if mode == "" {
			mode = "auto"
		}
		stream["xhttpSettings"] = map[string]any{"path": c.Path, "mode": mode}
	}
	cfg := map[string]any{
		"log": map[string]any{"loglevel": xrayLogLevel},
		"outbounds": []any{map[string]any{
			"protocol":       "vless",
			"settings":       map[string]any{"vnext": []any{map[string]any{"address": c.Address, "port": c.Port, "users": []any{user}}}},
			"streamSettings": stream,
		}},
	}
	raw, _ := json.Marshal(cfg)
	pb, err := serial.LoadJSONConfig(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	inst, err := core.New(pb)
	if err != nil {
		return nil, err
	}
	if err := inst.Start(); err != nil {
		inst.Close()
		return nil, err
	}
	return inst, nil
}

// countingConn tallies every byte this run moves over the operator's network,
// so the page can show how much of the data plan a run has cost.
type countingConn struct {
	net.Conn
	n *int64
}

func (c countingConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	atomic.AddInt64(c.n, int64(n))
	return n, err
}

func (c countingConn) Write(p []byte) (int, error) {
	n, err := c.Conn.Write(p)
	atomic.AddInt64(c.n, int64(n))
	return n, err
}

func tunnelClient(inst *core.Instance, used *int64) *http.Client {
	tr := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, portStr, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			port, err := strconv.Atoi(portStr)
			if err != nil {
				return nil, err
			}
			conn, err := core.Dial(ctx, inst, xnet.TCPDestination(xnet.ParseAddress(host), xnet.Port(port)))
			if err != nil {
				return nil, err
			}
			return countingConn{conn, used}, nil
		},
		TLSClientConfig:     &tls.Config{},
		ForceAttemptHTTP2:   false,
		MaxIdleConnsPerHost: 2,
		IdleConnTimeout:     30 * time.Second,
	}
	return &http.Client{Transport: tr}
}

func timedGet(ctx context.Context, client *http.Client, url string, timeout time.Duration) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode >= 400 {
		return 0, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return int(time.Since(start).Milliseconds()), nil
}

// download returns bytes per second over the whole transfer, and whether it
// ran into the time limit before the size was reached.
func download(ctx context.Context, client *http.Client, size int64) (int64, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, downloadTimeout)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL+strconv.FormatInt(size, 10), nil)
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return 0, false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return 0, false, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	n, err := io.Copy(io.Discard, resp.Body)
	elapsed := time.Since(start).Seconds()
	capped := err != nil && ctx.Err() != nil
	if err != nil && !capped {
		return 0, false, err
	}
	if n == 0 || elapsed <= 0 {
		return 0, capped, fmt.Errorf("هیچ داده‌ای نیامد")
	}
	return int64(float64(n) / elapsed), capped, nil
}

// patternReader serves size bytes of incompressible data without holding
// them in memory, and counts how many the transport actually took.
type patternReader struct {
	left  int64
	read  *int64
	block []byte
	off   int
}

func (p *patternReader) Read(b []byte) (int, error) {
	if p.left <= 0 {
		return 0, io.EOF
	}
	n := 0
	for n < len(b) && p.left > 0 {
		c := copy(b[n:], p.block[p.off:])
		if int64(c) > p.left {
			c = int(p.left)
		}
		n += c
		p.left -= int64(c)
		p.off = (p.off + c) % len(p.block)
	}
	atomic.AddInt64(p.read, int64(n))
	return n, nil
}

var uploadBlock = func() []byte {
	b := make([]byte, 64*1024)
	rand.New(rand.NewSource(1)).Read(b)
	return b
}()

// upload returns bytes per second. Done means the server answered after the
// whole body; if the time limit came first, the rate is what went out in that
// time, which is exactly the number a throttled link deserves.
func upload(ctx context.Context, client *http.Client, size int64) (int64, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, uploadTimeout)
	defer cancel()
	var sent int64
	body := &patternReader{left: size, read: &sent, block: uploadBlock}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, uploadURL, body)
	req.ContentLength = size
	req.Header.Set("Content-Type", "application/octet-stream")
	start := time.Now()
	resp, err := client.Do(req)
	elapsed := time.Since(start).Seconds()
	if err == nil {
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 400 {
			return 0, false, fmt.Errorf("HTTP %d", resp.StatusCode)
		}
		return int64(float64(size) / elapsed), false, nil
	}
	if ctx.Err() != nil {
		n := atomic.LoadInt64(&sent)
		if n == 0 {
			return 0, true, fmt.Errorf("هیچ داده‌ای نرفت")
		}
		return int64(float64(n) / elapsed), true, nil
	}
	return 0, false, err
}
