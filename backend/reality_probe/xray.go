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
	"strconv"
	"sync/atomic"
	"time"

	xnet "github.com/xtls/xray-core/common/net"
	"github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/infra/conf/serial"
	_ "github.com/xtls/xray-core/main/distro/all"
)

// Fetched through the tunnel, so they are reached from the node's side: the
// only leg that can be slow is the one between this device and the node.
const (
	delayURL    = "https://www.gstatic.com/generate_204"
	downloadURL = "https://speed.cloudflare.com/__down?bytes="
	uploadURL   = "https://speed.cloudflare.com/__up"
)

// PROBE_DEBUG=1 shows Xray's own log, for when a config fails and the
// reason is not obvious.
var xrayLogLevel = func() string {
	if os.Getenv("PROBE_DEBUG") != "" {
		return "debug"
	}
	return "none"
}()

func startXray(p Plan, t Target, fp string) (*core.Instance, error) {
	cfg := map[string]any{
		"log": map[string]any{"loglevel": xrayLogLevel},
		"outbounds": []any{map[string]any{
			"protocol": "vless",
			"settings": map[string]any{"vnext": []any{map[string]any{
				"address": p.Address, "port": t.Port,
				"users": []any{map[string]any{"id": p.UUID, "encryption": "none", "flow": "xtls-rprx-vision"}},
			}}},
			"streamSettings": map[string]any{
				"network": "tcp", "security": "reality",
				"realitySettings": map[string]any{
					"serverName": t.SNI, "fingerprint": fp, "publicKey": p.PublicKey, "shortId": p.ShortID,
				},
			},
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

// tunnelClient dials straight into the Xray instance: nothing listens, so
// tests cannot collide on a port.
func tunnelClient(inst *core.Instance) *http.Client {
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
			return core.Dial(ctx, inst, xnet.TCPDestination(xnet.ParseAddress(host), xnet.Port(port)))
		},
		TLSClientConfig:     &tls.Config{},
		MaxIdleConnsPerHost: 2,
		IdleConnTimeout:     30 * time.Second,
	}
	return &http.Client{Transport: tr}
}

func short(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	s := err.Error()
	if len(s) > 120 {
		s = s[:120]
	}
	return s
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

// download returns bytes per second over at most `limit`; hitting the time
// limit is normal and the rate so far is the answer.
func download(ctx context.Context, client *http.Client, size int64, limit time.Duration) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, limit)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL+strconv.FormatInt(size, 10), nil)
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return 0, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	n, err := io.Copy(io.Discard, resp.Body)
	if err != nil && ctx.Err() == nil {
		return 0, err
	}
	elapsed := time.Since(start).Seconds()
	if n == 0 || elapsed <= 0 {
		return 0, fmt.Errorf("no data")
	}
	return int64(float64(n) / elapsed), nil
}

// patternReader serves incompressible bytes without holding them in memory
// and counts how many the transport actually took.
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

// upload returns bytes per second. The time limit coming first is the
// normal case: the rate is what went out in that time, which is exactly the
// number a throttled link deserves.
func upload(ctx context.Context, client *http.Client, size int64, limit time.Duration) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, limit)
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
			return 0, fmt.Errorf("HTTP %d", resp.StatusCode)
		}
		return int64(float64(size) / elapsed), nil
	}
	if ctx.Err() != nil {
		n := atomic.LoadInt64(&sent)
		if n < 64*1024 {
			return 0, fmt.Errorf("almost nothing went out")
		}
		return int64(float64(n) / elapsed), nil
	}
	return 0, err
}
