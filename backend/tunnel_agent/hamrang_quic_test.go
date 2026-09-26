package main

import (
	"bytes"
	"crypto/rand"
	"io"
	"testing"
	"time"
)

// TestHamrangQUICRoundTrip dials the QUIC camouflage listener and pushes 4MB
// through one stream each way, confirming the listener/dialer pair carries a
// real tunnel payload intact.
func TestHamrangQUICRoundTrip(t *testing.T) {
	ln, err := hamrangListenQUIC("127.0.0.1:0", "www.digikala.com")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	payload := make([]byte, 4<<20)
	rand.Read(payload)

	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		io.Copy(c, io.LimitReader(c, int64(len(payload)))) // echo back
	}()

	c, err := hamrangDialQUIC(ln.Addr().String(), "www.digikala.com", 5*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.Close()
	go c.Write(payload)
	got := make([]byte, len(payload))
	c.SetReadDeadline(time.Now().Add(20 * time.Second))
	if _, err := io.ReadFull(c, got); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatal("payload corrupted over quic")
	}
}

func TestHamrangQUICNeedsSNI(t *testing.T) {
	if _, err := hamrangDialQUIC("127.0.0.1:1", "", time.Second); err == nil {
		t.Fatal("expected error without SNI")
	}
}
