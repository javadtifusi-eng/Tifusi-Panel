package main

import (
	"net"
	"strconv"
	"testing"
	"time"
)

// A local service that answers from a different local address than the one
// it was sent to must still reach the tunnel (xray's WireGuard does this).
func TestLocalUDPAcceptsReplyFromOtherLocalAddr(t *testing.T) {
	srv, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	port := srv.LocalAddr().(*net.UDPAddr).Port
	// A second socket on the same port can't exist, so emulate "answers from
	// another address" by replying from 127.0.0.1 while we sent to 127.0.0.2.
	go func() {
		buf := make([]byte, 64)
		n, from, err := srv.ReadFromUDP(buf)
		if err == nil {
			srv.WriteToUDP(buf[:n], from)
		}
	}()
	c, err := dialLocalUDP(net.ParseIP("127.0.0.3"), net.JoinHostPort("127.0.0.2", itoa(port)))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := c.Write([]byte("ping")); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 64)
	n, err := c.Read(buf)
	if err != nil || string(buf[:n]) != "ping" {
		t.Fatalf("reply not delivered: %q %v", buf[:n], err)
	}
}

func itoa(n int) string { return strconv.Itoa(n) }
