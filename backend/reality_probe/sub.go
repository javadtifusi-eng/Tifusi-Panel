package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Config is one REALITY inbound of the field test, as its vless:// link
// describes it.
type Config struct {
	Label     string `json:"label"`
	Link      string `json:"link"`
	UUID      string `json:"-"`
	Address   string `json:"address"`
	Port      int    `json:"port"`
	SNI       string `json:"sni"`
	PublicKey string `json:"-"`
	ShortID   string `json:"-"`
	Flow      string `json:"-"`
	Network   string `json:"network"`
	Path      string `json:"-"`
	Mode      string `json:"-"`
}

// fetchSubscription reads the panel's field-test subscription. It is fetched
// directly, not through any proxy: the panel's address has to be reachable
// from this network anyway for the configs in it to be worth testing.
func fetchSubscription(raw string) ([]Config, error) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "vless://") {
		return parseLinks(raw)
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, fmt.Errorf("لینک اشتراک تست میدانی را از پنل کپی کن (با https:// شروع می‌شود)")
	}
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Get(raw)
	if err != nil {
		return nil, fmt.Errorf("پنل جواب نداد: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return nil, fmt.Errorf("این تست میدانی تمام شده؛ از پنل دوباره شروعش کن")
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("پنل خطای %d داد", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	text := strings.TrimSpace(string(body))
	if decoded, err := decodeB64(text); err == nil && strings.Contains(decoded, "://") {
		text = decoded
	}
	return parseLinks(text)
}

func decodeB64(s string) (string, error) {
	s = strings.TrimSpace(s)
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if b, err := enc.DecodeString(s); err == nil {
			return string(b), nil
		}
	}
	return "", fmt.Errorf("not base64")
}

func parseLinks(text string) ([]Config, error) {
	var out []Config
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "vless://") {
			continue
		}
		c, err := parseVless(line)
		if err == nil {
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		return nil, errNoConfigs
	}
	return out, nil
}

func parseVless(link string) (Config, error) {
	u, err := url.Parse(link)
	if err != nil {
		return Config{}, err
	}
	q := u.Query()
	if q.Get("security") != "reality" {
		return Config{}, fmt.Errorf("not reality")
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || u.User == nil || u.User.Username() == "" || q.Get("pbk") == "" {
		return Config{}, fmt.Errorf("incomplete link")
	}
	network := q.Get("type")
	if network == "" {
		network = "tcp"
	}
	label, _ := url.PathUnescape(u.Fragment)
	return Config{
		Label: label, Link: link, UUID: u.User.Username(),
		Address: u.Hostname(), Port: port, SNI: q.Get("sni"),
		PublicKey: q.Get("pbk"), ShortID: q.Get("sid"), Flow: q.Get("flow"),
		Network: network, Path: q.Get("path"), Mode: q.Get("mode"),
	}, nil
}

// withFingerprint is the same link with its fp swapped, so the winning
// combination can be pasted straight into a client or the panel.
func withFingerprint(link, fp string) string {
	u, err := url.Parse(link)
	if err != nil {
		return link
	}
	q := u.Query()
	q.Set("fp", fp)
	u.RawQuery = q.Encode()
	return u.String()
}
