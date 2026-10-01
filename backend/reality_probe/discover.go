package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// Automatic mode: the probe finds its own targets on the operator it is
// sitting on, instead of taking a list the panel picked from a datacenter.
//
//  1. ask the panel for a page of popular names (only a list, no checks),
//  2. TLS-handshake each one directly from this laptop — whatever the operator
//     blocks, poisons or slows shows up right here,
//  3. ask the panel to open field-test inbounds for the quickest few,
//  4. measure every one through the tunnel per fingerprint, as before.

const (
	discoverConcurrency = 48
	discoverTimeout     = 5 * time.Second
	// The quickest this many get three more one-at-a-time handshakes, so the
	// final pick is not decided by noise from the concurrent first pass.
	refineTop = 40
)

type panelClient struct {
	base string
	key  string
	http *http.Client
}

func newPanel(base, key string) (*panelClient, error) {
	base = strings.TrimSpace(base)
	key = strings.TrimSpace(key)
	if base == "" || key == "" {
		return nil, errors.New("آدرس پنل و کلید API را وارد کن")
	}
	if !strings.Contains(base, "://") {
		base = "https://" + base
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" {
		return nil, errors.New("آدرس پنل درست نیست")
	}
	return &panelClient{base: strings.TrimRight(u.Scheme+"://"+u.Host, "/"), key: key, http: &http.Client{Timeout: 30 * time.Second}}, nil
}

func (p *panelClient) call(ctx context.Context, method, path string, body any, out any) error {
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, p.base+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+p.key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := p.http.Do(req)
	if err != nil {
		return fmt.Errorf("پنل از این اینترنت باز نشد (%v) — آدرس پنل باید پشت آروان باشد", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	switch {
	case resp.StatusCode == 401:
		return errors.New("کلید API درست نیست یا پاک شده")
	case resp.StatusCode == 403:
		return errors.New("این کلید API اجازه‌ی «هسته‌ها» را ندارد")
	case resp.StatusCode >= 400:
		var e struct {
			Detail any `json:"detail"`
		}
		json.Unmarshal(data, &e)
		return fmt.Errorf("پنل خطای %d داد: %v", resp.StatusCode, e.Detail)
	}
	return json.Unmarshal(data, out)
}

type nodeInfo struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

// pickNode takes the first connected node: field-test inbounds have to open
// on a node that is up.
func (p *panelClient) pickNode(ctx context.Context) (nodeInfo, error) {
	var res struct {
		Nodes []nodeInfo `json:"nodes"`
	}
	if err := p.call(ctx, http.MethodGet, "/api/nodes", nil, &res); err != nil {
		return nodeInfo{}, err
	}
	for _, n := range res.Nodes {
		if n.Status == "connected" {
			return n, nil
		}
	}
	if len(res.Nodes) == 0 {
		return nodeInfo{}, errors.New("پنل هیچ نودی ندارد")
	}
	return nodeInfo{}, errors.New("هیچ نودی وصل نیست")
}

func (p *panelClient) candidates(ctx context.Context, page, size int) ([]string, error) {
	var res struct {
		Names []string `json:"names"`
	}
	if err := p.call(ctx, http.MethodGet, fmt.Sprintf("/api/reality/candidates?page=%d&size=%d", page, size), nil, &res); err != nil {
		return nil, err
	}
	if len(res.Names) == 0 {
		return nil, errors.New("پنل لیست سایت‌ها را نداد")
	}
	return res.Names, nil
}

// openField asks the panel for one throwaway REALITY inbound per host and
// returns their configs straight from the answer, with no second fetch.
func (p *panelClient) openField(ctx context.Context, nodeID int, hosts []string) ([]Config, error) {
	targets := make([]map[string]any, 0, len(hosts))
	for _, h := range hosts {
		targets = append(targets, map[string]any{"host": h, "dest": h + ":443"})
	}
	var res struct {
		Items []struct {
			Link string `json:"link"`
		} `json:"items"`
	}
	if err := p.call(ctx, http.MethodPost, fmt.Sprintf("/api/reality/nodes/%d/field-test", nodeID), map[string]any{"targets": targets}, &res); err != nil {
		return nil, err
	}
	var out []Config
	for _, it := range res.Items {
		if c, err := parseVless(it.Link); err == nil {
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		return nil, errNoConfigs
	}
	return out, nil
}

type Found struct {
	Host string `json:"host"`
	Ms   int    `json:"ms"`
}

// handshake is what a REALITY client's first packets go through on this
// operator: a direct TLS 1.3 + h2 handshake to the real site under its own
// name. A poisoned DNS answer, a blocked SNI or a mangled hello all fail here.
func handshake(ctx context.Context, host string) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, discoverTimeout)
	defer cancel()
	start := time.Now()
	d := &tls.Dialer{
		NetDialer: &net.Dialer{},
		Config:    &tls.Config{ServerName: host, NextProtos: []string{"h2", "http/1.1"}, MinVersion: tls.VersionTLS13},
	}
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(host, "443"))
	if err != nil {
		return 0, err
	}
	defer conn.Close()
	st := conn.(*tls.Conn).ConnectionState()
	if st.Version != tls.VersionTLS13 || st.NegotiatedProtocol != "h2" {
		return 0, errors.New("needs TLS 1.3 and HTTP/2")
	}
	return int(time.Since(start).Milliseconds()), nil
}

// discover handshakes every name concurrently, then re-times the quickest
// one at a time and returns them fastest first.
func discover(ctx context.Context, names []string, progress func(done, ok int)) []Found {
	var (
		mu    sync.Mutex
		found []Found
		done  int
		wg    sync.WaitGroup
		sem   = make(chan struct{}, discoverConcurrency)
	)
	for _, name := range names {
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(h string) {
			defer wg.Done()
			defer func() { <-sem }()
			ms, err := handshake(ctx, h)
			mu.Lock()
			done++
			if err == nil {
				found = append(found, Found{h, ms})
			}
			progress(done, len(found))
			mu.Unlock()
		}(name)
	}
	wg.Wait()
	sort.Slice(found, func(a, b int) bool { return found[a].Ms < found[b].Ms })

	top := found
	if len(top) > refineTop {
		top = top[:refineTop]
	}
	for i := range top {
		if ctx.Err() != nil {
			break
		}
		var times []int
		for k := 0; k < 3; k++ {
			if ms, err := handshake(ctx, top[i].Host); err == nil {
				times = append(times, ms)
			}
		}
		if len(times) == 0 {
			top[i].Ms = 1 << 30 // answered once under load, then stopped: not a target
			continue
		}
		sort.Ints(times)
		top[i].Ms = times[len(times)/2]
	}
	sort.Slice(top, func(a, b int) bool { return top[a].Ms < top[b].Ms })
	for len(top) > 0 && top[len(top)-1].Ms == 1<<30 {
		top = top[:len(top)-1]
	}
	return top
}

// Auto is one automatic run: discovery, then the usual per-fingerprint job.
type Auto struct {
	mu        sync.Mutex
	Phase     string    `json:"phase"` // panel | discovering | opening | testing | done | error
	Error     string    `json:"error,omitempty"`
	Node      string    `json:"node,omitempty"`
	DiscTotal int       `json:"disc_total"`
	DiscDone  int       `json:"disc_done"`
	DiscOK    int       `json:"disc_ok"`
	Found     []Found   `json:"found,omitempty"`
	Picked    []string  `json:"picked,omitempty"`
	job       *Job
	started   time.Time
}

type autoRequest struct {
	Panel        string   `json:"panel"`
	Key          string   `json:"key"`
	Count        int      `json:"count"`
	Top          int      `json:"top"`
	Fingerprints []string `json:"fingerprints"`
	UploadMB     int      `json:"upload_mb"`
	DownloadMB   int      `json:"download_mb"`
}

func (a *Auto) set(f func(*Auto)) {
	a.mu.Lock()
	f(a)
	a.mu.Unlock()
}

func (a *Auto) Running() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.Phase == "testing" && a.job != nil {
		return a.job.Running()
	}
	return a.Phase != "done" && a.Phase != "error"
}

// Snapshot is the job's own snapshot (when there is one) with the discovery
// state alongside, so the page renders both from one poll.
func (a *Auto) Snapshot() map[string]any {
	a.mu.Lock()
	view := map[string]any{
		"phase": a.Phase, "error": a.Error, "node": a.Node, "disc_total": a.DiscTotal,
		"disc_done": a.DiscDone, "disc_ok": a.DiscOK, "found": a.Found, "picked": a.Picked,
	}
	j := a.job
	a.mu.Unlock()
	out := map[string]any{"state": "running"}
	if j != nil {
		out = j.Snapshot()
	}
	if !a.Running() {
		out["state"] = "done"
	}
	out["auto"] = view
	return out
}

func (a *Auto) Run(ctx context.Context, req autoRequest, fps []string) {
	fail := func(err error) { a.set(func(a *Auto) { a.Phase, a.Error = "error", err.Error() }) }
	p, err := newPanel(req.Panel, req.Key)
	if err != nil {
		fail(err)
		return
	}
	node, err := p.pickNode(ctx)
	if err != nil {
		fail(err)
		return
	}
	names, err := p.candidates(ctx, 0, req.Count)
	if err != nil {
		fail(err)
		return
	}
	a.set(func(a *Auto) { a.Node, a.Phase, a.DiscTotal = node.Name, "discovering", len(names) })

	found := discover(ctx, names, func(done, ok int) {
		a.set(func(a *Auto) { a.DiscDone, a.DiscOK = done, ok })
	})
	if ctx.Err() != nil {
		fail(errors.New("متوقف شد"))
		return
	}
	if len(found) == 0 {
		fail(errors.New("هیچ سایتی از این اینترنت با TLS 1.3 و HTTP/2 جواب نداد — VPN خاموش است؟"))
		return
	}
	show := found
	if len(show) > 20 {
		show = show[:20]
	}
	picked := make([]string, 0, req.Top)
	for _, f := range found {
		if len(picked) == req.Top {
			break
		}
		picked = append(picked, f.Host)
	}
	a.set(func(a *Auto) { a.Found, a.Picked, a.Phase = show, picked, "opening" })

	configs, err := p.openField(ctx, node.ID, picked)
	if err != nil {
		fail(err)
		return
	}
	// The node starts its throwaway Xray asynchronously; give it a moment
	// before the first config is dialled.
	select {
	case <-ctx.Done():
		fail(errors.New("متوقف شد"))
		return
	case <-time.After(3 * time.Second):
	}
	job := NewJob(configs, fps, req.UploadMB, req.DownloadMB)
	a.set(func(a *Auto) { a.job, a.Phase = job, "testing" })
	job.Run(ctx)
	a.set(func(a *Auto) { a.Phase = "done" })
}
