package main

import (
	"crypto/tls"
	"net"
	"testing"
	"time"
)

func TestHamrangTransportPredicates(t *testing.T) {
	if !isTLSTransport(transportHamrang) {
		t.Fatal("hamrang must be a TLS transport")
	}
	if !isWSTransport(transportHamrang) {
		t.Fatal("hamrang must be a WS transport")
	}
	if !isMuxTransport(transportHamrang) {
		t.Fatal("hamrang must be a mux transport")
	}
	// sanity: plain tcp is none of these
	if isTLSTransport("tcp") || isWSTransport("tcp") {
		t.Fatal("tcp should not be TLS/WS")
	}
}

func TestHamrangClientTLSRequiresSNI(t *testing.T) {
	c1, c2 := net.Pipe()
	defer c1.Close()
	defer c2.Close()
	if _, err := hamrangClientTLS(c1, "", time.Second); err == nil {
		t.Fatal("expected error when SNI is empty")
	}
}

func TestHamrangConfigValidation(t *testing.T) {
	base := func() *Config {
		return &Config{Mode: "client", Transport: transportHamrang, Token: "supersecret", Server: "1.2.3.4:8443"}
	}
	c := base()
	c.SNI = ""
	if err := c.validate(); err == nil {
		t.Fatal("hamrang without SNI should fail validation")
	}
	c = base()
	c.SNI = "www.digikala.com"
	if err := c.validate(); err != nil {
		t.Fatalf("hamrang with SNI should validate, got %v", err)
	}
}

// TestHamrangHandshakeInterop confirms the uTLS browser-fingerprinted client
// completes a handshake against the tunnel's own self-signed TLS server and
// that bytes flow — i.e. the camouflage handshake is wire-compatible with the
// wssmux server it will actually face.
func TestHamrangHandshakeInterop(t *testing.T) {
	tc, err := tlsServerConfig("www.digikala.com")
	if err != nil {
		t.Fatalf("tlsServerConfig: %v", err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	done := make(chan struct{})
	go func() {
		defer close(done)
		raw, err := ln.Accept()
		if err != nil {
			return
		}
		defer raw.Close()
		srv := tls.Server(raw, tc)
		if err := srv.Handshake(); err != nil {
			t.Errorf("server handshake: %v", err)
			return
		}
		buf := make([]byte, 5)
		if _, err := srv.Read(buf); err != nil {
			t.Errorf("server read: %v", err)
			return
		}
		srv.Write([]byte("pong!"))
	}()

	raw, err := net.DialTimeout("tcp", ln.Addr().String(), 3*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer raw.Close()
	cli, err := hamrangClientTLS(raw, "www.digikala.com", 3*time.Second)
	if err != nil {
		t.Fatalf("hamrang client handshake: %v", err)
	}
	if _, err := cli.Write([]byte("hello")); err != nil {
		t.Fatalf("client write: %v", err)
	}
	buf := make([]byte, 5)
	if _, err := cli.Read(buf); err != nil {
		t.Fatalf("client read: %v", err)
	}
	if string(buf) != "pong!" {
		t.Fatalf("got %q, want pong!", string(buf))
	}
	<-done
}
