package main

import (
	"log"
	"net"
	"os/exec"
	"sort"
	"strings"
)

// fwRule is one iptables rule a raw carrier installs while it is open.
type fwRule struct {
	table string // "" means filter
	chain string
	args  []string
}

func (r fwRule) cmd(op string) []string {
	// -w waits for the xtables lock: in auto mode every carrier installs its
	// rules at the same moment, and without it all but one would fail.
	a := []string{"-w"}
	if r.table != "" {
		a = append(a, "-t", r.table)
	}
	return append(append(a, op, r.chain), r.args...)
}

func (r fwRule) String() string { return strings.Join(r.cmd("-I"), " ") }

// installFW inserts rules at the top of their chains, ahead of ufw's and any
// other INVALID-dropping jumps, and returns the ones that went in. It is
// best-effort like the carriers themselves: on a host without iptables the
// tunnel still runs, it just depends on the host firewall letting it through.
func installFW(what string, rules []fwRule) []fwRule {
	var done []fwRule
	for _, r := range rules {
		// A crash or SIGKILL skips close(), leaving the rule behind; clear any
		// leftovers first so restarts don't stack duplicates.
		for i := 0; i < 32; i++ {
			if exec.Command("iptables", r.cmd("-D")...).Run() != nil {
				break
			}
		}
		if out, err := exec.Command("iptables", r.cmd("-I")...).CombinedOutput(); err != nil {
			log.Printf("%s: could not install firewall rule %q: %v: %s", what, r, err, out)
			continue
		}
		done = append(done, r)
	}
	return done
}

func removeFW(what string, rules []fwRule) {
	for _, r := range rules {
		if out, err := exec.Command("iptables", r.cmd("-D")...).CombinedOutput(); err != nil {
			log.Printf("%s: could not remove firewall rule %q (clean it up by hand): %v: %s", what, r, err, out)
		}
	}
}

// iptablesHasU32 reports whether the u32 match loads, so the ICMP rules can be
// narrowed to this tunnel's Echo id instead of every Echo Reply on the host.
func iptablesHasU32() bool {
	return exec.Command("iptables", "-w", "-m", "u32", "-h").Run() == nil
}

// peerList is the peer-source pin as an iptables address list ("a,b,c"),
// which iptables expands into one rule per address. Empty when no pin is set.
func (o *spoofOpts) peerList() string {
	if o == nil || len(o.peerSrcs) == 0 {
		return ""
	}
	ips := make([]string, 0, len(o.peerSrcs))
	for k := range o.peerSrcs {
		ips = append(ips, net.IP(k[:]).String())
	}
	sort.Strings(ips)
	return strings.Join(ips, ",")
}

// passRules exempts one carrier's traffic from conntrack in both directions
// and accepts it in INPUT. in matches our inbound packets, out our outbound
// ones; src (the peer pin, may be empty) narrows the inbound side further.
func passRules(in, out []string, src string) []fwRule {
	if src != "" {
		in = append([]string{"-s", src}, in...)
	}
	return []fwRule{
		{table: "raw", chain: "PREROUTING", args: append(append([]string{}, in...), "-j", "NOTRACK")},
		{chain: "INPUT", args: append(append([]string{}, in...), "-j", "ACCEPT")},
		{table: "raw", chain: "OUTPUT", args: append(append([]string{}, out...), "-j", "NOTRACK")},
	}
}
