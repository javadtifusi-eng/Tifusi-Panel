package main

import (
	"testing"
	"time"
)

func TestSummarise(t *testing.T) {
	ms := time.Millisecond
	st := summarise(5, []time.Duration{10 * ms, 20 * ms, 10 * ms, 30 * ms})
	if st.got != 4 || st.loss() != 20 {
		t.Errorf("got %d loss %v", st.got, st.loss())
	}
	if st.min != 10*ms || st.max != 30*ms || st.avg != 17500*time.Microsecond {
		t.Errorf("min/avg/max %v/%v/%v", st.min, st.avg, st.max)
	}
	// |20-10| + |10-20| + |30-10| = 40 over 3 steps.
	if want := 40 * ms / 3; st.jitter != want {
		t.Errorf("jitter %v, want %v", st.jitter, want)
	}
	if empty := summarise(3, nil); empty.got != 0 || empty.loss() != 100 {
		t.Errorf("empty: %+v", empty)
	}
}

func TestRecommendTransport(t *testing.T) {
	ms := time.Millisecond
	clean := linkStats{sent: 100, got: 100, jitter: 2 * ms}
	lossy := linkStats{sent: 100, got: 90, jitter: 5 * ms}
	none := linkStats{sent: 100}
	tcpOK := linkStats{sent: 10, got: 10}
	tcpBad := linkStats{sent: 10, got: 5}
	cases := []struct {
		udp, tcp linkStats
		want     string
	}{
		{clean, tcpOK, "tcpmux"},
		{lossy, tcpOK, "udp"},
		{none, tcpOK, "tcpmux"},
		{clean, tcpBad, "udp"},
		{none, tcpBad, "none"},
	}
	for _, c := range cases {
		if got, _ := recommendTransport(c.udp, c.tcp, 10); got != c.want {
			t.Errorf("udp %+v tcp %+v: got %s, want %s", c.udp, c.tcp, got, c.want)
		}
	}
}
