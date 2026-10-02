// Tifusi Reality Probe: measures REALITY names from inside Iran, on the
// operator the phone or laptop is on — above all the upload, which MCI
// throttles per SNI while download stays fine.
//
// Usage: tifusi-probe <link from the panel>
// (on Windows, double-click and paste the link when asked).
//
// Round 1: every candidate on one port, chrome only, a short upload each.
// Round 2: the best few, each on its own port and on the shared standard
// ports; then the best configs again with every fingerprint.
// Results go back to the panel after each round.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
)

const (
	round1Up    = 4 * time.Second
	round2Up    = 8 * time.Second
	round2Down  = 5 * time.Second
	round2Top   = 8
	fpTop       = 5
	connectWait = 8 * time.Second
)

type Plan struct {
	State        string   `json:"state"`
	Error        string   `json:"error"`
	Round        int      `json:"round"`
	Address      string   `json:"address"`
	UUID         string   `json:"uuid"`
	PublicKey    string   `json:"public_key"`
	ShortID      string   `json:"short_id"`
	Fingerprints []string `json:"fingerprints"`
	Configs      []Target `json:"configs"`
}

type Target struct {
	SNI      string `json:"sni"`
	Port     int    `json:"port"`
	Standard bool   `json:"standard"`
	Source   string `json:"source"`
}

type Result struct {
	SNI         string `json:"sni"`
	Port        int    `json:"port"`
	Fingerprint string `json:"fingerprint"`
	Source      string `json:"-"`
	OK          bool   `json:"ok"`
	DelayMs     int    `json:"delay_ms,omitempty"`
	UpBps       int64  `json:"up_bps,omitempty"`
	DownBps     int64  `json:"down_bps,omitempty"`
	Error       string `json:"error,omitempty"`
}

// api talks to the panel: directly at first, then through the best round-1
// config, because the panel may not open on the operator being tested while
// the node's test inbounds, by definition, do.
var api = &http.Client{Timeout: 60 * time.Second}

var stdin = bufio.NewReader(os.Stdin)

func ask(msg string) {
	fmt.Print(msg)
	stdin.ReadString('\n')
}

// useTunnel routes every later panel call through one test config. The
// instance stays up until the program ends.
func useTunnel(p Plan, r Result) {
	inst, err := startXray(p, Target{SNI: r.SNI, Port: r.Port}, r.Fingerprint)
	if err != nil {
		return
	}
	api = &http.Client{Transport: tunnelClient(inst).Transport, Timeout: 60 * time.Second}
}

func main() {
	link := ""
	if len(os.Args) > 1 {
		link = os.Args[1]
	} else {
		fmt.Print("لینک اسکنر را از پنل کپی کن و اینجا بچسبان، بعد Enter:\n> ")
		link, _ = stdin.ReadString('\n')
	}
	link = strings.TrimRight(strings.TrimSpace(link), "/")
	if err := run(link); err != nil {
		fmt.Println("\n❌", err)
	}
	if len(os.Args) <= 1 {
		ask("\nبرای بستن Enter بزن.")
	}
}

func run(link string) error {
	if !strings.HasPrefix(link, "http") {
		return fmt.Errorf("لینک باید با https:// شروع شود")
	}
	var plan Plan
	viaVPN := false
	if err := getJSON(link, &plan); err != nil {
		fmt.Println("⚠️ پنل بدون VPN باز نشد:", err)
		ask("👈 فقط برای گرفتن لیست، VPN را روشن کن و Enter بزن...")
		viaVPN = true
	}
	fmt.Println("⏳ منتظر پنل (جمع‌کردن سایت‌ها روی نود ۱ تا ۲ دقیقه طول می‌کشد)...")
	for {
		if err := getJSON(link, &plan); err != nil {
			return err
		}
		if plan.State == "failed" {
			return fmt.Errorf("پنل: %s", plan.Error)
		}
		if plan.State == "ready" {
			break
		}
		time.Sleep(5 * time.Second)
	}
	if viaVPN {
		ask("✅ لیست رسید. حالا VPN را خاموش کن (تست باید روی اینترنت خود اپراتور باشد) و Enter بزن...")
	}
	// Our own address on the operator, read directly (never through a
	// tunnel), so the panel can name the operator even when the results
	// reach it through the node.
	myIP = publicIP()
	if plan.Round != 1 {
		// Round 2 was already opened by an earlier run of the probe; start
		// over from the panel rather than guess what round 1 found.
		fmt.Println("ℹ️ این اسکن قبلاً دور ۲ را شروع کرده؛ همان را دوباره می‌سنجم.")
	} else {
		fmt.Printf("\n━━ دور ۱: %d سایت، هر کدام روی پورت خودش (چند ثانیه اپلود) ━━\n", len(plan.Configs))
		var r1 []Result
		for i, t := range plan.Configs {
			res := measure(plan, t, "chrome", round1Up, 0)
			r1 = append(r1, res)
			printRow(i+1, len(plan.Configs), res)
		}
		sortResults(r1)
		if r1[0].OK {
			useTunnel(plan, r1[0])
		}
		report(link, 1, r1)
		var top []string
		for _, r := range r1 {
			if r.OK && len(top) < round2Top {
				top = append(top, r.SNI)
			}
		}
		if len(top) == 0 {
			printTable("دور ۱", r1, 15)
			return fmt.Errorf("هیچ سایتی روی این اینترنت وصل نشد")
		}
		printTable("بهترین‌های دور ۱", r1, round2Top)
		if err := postJSON(link+"/round2", map[string]any{"hosts": top}, &plan); err != nil {
			return err
		}
		time.Sleep(2 * time.Second)
	}

	fmt.Printf("\n━━ دور ۲: %d کانفیگ (بهترین‌ها + پورت‌های 8443 و 2053) ━━\n", len(plan.Configs))
	var r2 []Result
	for i, t := range plan.Configs {
		res := measure(plan, t, "chrome", round2Up, round2Down)
		r2 = append(r2, res)
		printRow(i+1, len(plan.Configs), res)
	}
	sortResults(r2)
	var fpRuns []Result
	var best []Result
	for _, r := range r2 {
		if r.OK && len(best) < fpTop {
			best = append(best, r)
		}
	}
	fps := []string{}
	for _, f := range plan.Fingerprints {
		if f != "chrome" {
			fps = append(fps, f)
		}
	}
	if len(best) > 0 {
		fmt.Printf("\n━━ دور ۲ (fingerprint): %d کانفیگ برتر × %d ━━\n", len(best), len(fps))
		n, total := 0, len(best)*len(fps)
		for _, b := range best {
			for _, fp := range fps {
				n++
				res := measure(plan, Target{SNI: b.SNI, Port: b.Port, Source: b.Source}, fp, round2Up, round2Down)
				fpRuns = append(fpRuns, res)
				printRow(n, total, res)
			}
		}
	}
	all := append(r2, fpRuns...)
	report(link, 2, all)
	sortResults(all)
	printTable("🏆 نتیجه‌ی نهایی (بر اساس اپلود)", all, 15)
	return nil
}

func measure(p Plan, t Target, fp string, upFor, downFor time.Duration) Result {
	res := Result{SNI: t.SNI, Port: t.Port, Fingerprint: fp, Source: t.Source}
	inst, err := startXray(p, t, fp)
	if err != nil {
		res.Error = "config: " + short(err)
		return res
	}
	defer inst.Close()
	client := tunnelClient(inst)
	defer client.CloseIdleConnections()
	ctx := context.Background()
	if _, err := timedGet(ctx, client, delayURL, connectWait); err != nil {
		res.Error = "connect: " + short(err)
		return res
	}
	if ms, err := timedGet(ctx, client, delayURL, connectWait); err == nil {
		res.DelayMs = ms
	}
	if downFor > 0 {
		if down, err := download(ctx, client, 8_000_000, downFor); err == nil {
			res.DownBps = down
		}
	}
	up, err := upload(ctx, client, 50_000_000, upFor)
	if err != nil {
		res.Error = "upload: " + short(err)
		return res
	}
	res.UpBps, res.OK = up, true
	return res
}

func sortResults(rs []Result) {
	sort.SliceStable(rs, func(a, b int) bool {
		if rs[a].OK != rs[b].OK {
			return rs[a].OK
		}
		if rs[a].UpBps != rs[b].UpBps {
			return rs[a].UpBps > rs[b].UpBps
		}
		return rs[a].DelayMs < rs[b].DelayMs
	})
}

func mbps(bps int64) string { return fmt.Sprintf("%.2f", float64(bps)*8/1e6) }

func printRow(i, n int, r Result) {
	if r.OK {
		down := ""
		if r.DownBps > 0 {
			down = " ↓" + mbps(r.DownBps)
		}
		fmt.Printf("[%d/%d] ✅ %-32s :%-5d %-8s ↑%s Mbps%s  %dms\n", i, n, r.SNI, r.Port, r.Fingerprint, mbps(r.UpBps), down, r.DelayMs)
	} else {
		fmt.Printf("[%d/%d] ❌ %-32s :%-5d %-8s %s\n", i, n, r.SNI, r.Port, r.Fingerprint, r.Error)
	}
}

func printTable(title string, rs []Result, n int) {
	fmt.Printf("\n%s\n", title)
	fmt.Printf("%-3s %-32s %-6s %-8s %-9s %-9s %s\n", "#", "SNI", "port", "fp", "up Mbps", "down", "ping")
	for i, r := range rs {
		if i >= n || !r.OK {
			break
		}
		down := "-"
		if r.DownBps > 0 {
			down = mbps(r.DownBps)
		}
		fmt.Printf("%-3d %-32s %-6d %-8s %-9s %-9s %dms\n", i+1, r.SNI, r.Port, r.Fingerprint, mbps(r.UpBps), down, r.DelayMs)
	}
}

func report(link string, round int, rs []Result) {
	var out struct {
		Saved    int    `json:"saved"`
		Operator string `json:"operator"`
	}
	if err := postJSON(link+"/results", map[string]any{"round": round, "results": rs, "client_ip": myIP}, &out); err != nil {
		fmt.Println("⚠️ نتیجه به پنل نرسید:", err)
		return
	}
	fmt.Printf("📨 %d نتیجه در پنل ثبت شد (اپراتور: %s)\n", out.Saved, out.Operator)
}

var myIP string

func publicIP() string {
	c := &http.Client{Timeout: 10 * time.Second}
	for _, u := range []string{"https://api.ipify.org", "https://icanhazip.com", "https://ifconfig.me/ip"} {
		resp, err := c.Get(u)
		if err != nil {
			continue
		}
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 64))
		resp.Body.Close()
		if ip := strings.TrimSpace(string(b)); resp.StatusCode == 200 && ip != "" {
			return ip
		}
	}
	return ""
}

func getJSON(url string, v any) error {
	resp, err := api.Get(url)
	if err != nil {
		return fmt.Errorf("پنل جواب نداد: %v", err)
	}
	return decode(resp, v)
}

func postJSON(url string, body any, v any) error {
	raw, _ := json.Marshal(body)
	resp, err := api.Post(url, "application/json", bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("پنل جواب نداد: %v", err)
	}
	return decode(resp, v)
}

func decode(resp *http.Response, v any) error {
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode == 404 {
		return fmt.Errorf("این اسکن تمام شده یا لینک اشتباه است؛ از پنل دوباره شروع کن")
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("پنل خطای %d داد: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return json.Unmarshal(body, v)
}
