package main

import (
	"bytes"
	"encoding/binary"
	"net"
	"testing"
	"time"
)

func TestBuildProxyV2IPv4(t *testing.T) {
	src := &net.TCPAddr{IP: net.ParseIP("5.6.7.8"), Port: 51000}
	dst := &net.TCPAddr{IP: net.ParseIP("94.183.153.140"), Port: 443}
	h, err := buildProxyV2(src, dst)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(h[:12], proxyV2Sig) || h[12] != 0x21 || h[13] != 0x11 {
		t.Fatalf("bad v2 preamble: % x", h[:14])
	}
	if l := binary.BigEndian.Uint16(h[14:16]); l != 12 || len(h) != 16+12 {
		t.Fatalf("length %d, header %d bytes", l, len(h))
	}
	if !net.IP(h[16:20]).Equal(src.IP) || !net.IP(h[20:24]).Equal(dst.IP) {
		t.Errorf("addresses % x", h[16:24])
	}
	if binary.BigEndian.Uint16(h[24:26]) != 51000 || binary.BigEndian.Uint16(h[26:28]) != 443 {
		t.Errorf("ports % x", h[24:28])
	}
}

func TestBuildProxyV2IPv6(t *testing.T) {
	src := &net.TCPAddr{IP: net.ParseIP("2001:db8::1"), Port: 1}
	dst := &net.TCPAddr{IP: net.ParseIP("2001:db8::2"), Port: 2}
	h, err := buildProxyV2(src, dst)
	if err != nil {
		t.Fatal(err)
	}
	if h[13] != 0x21 || binary.BigEndian.Uint16(h[14:16]) != 36 || len(h) != 16+36 {
		t.Fatalf("bad v6 header: % x", h[:16])
	}
}

func TestWriteProxyHeaderSkipsWithoutSrc(t *testing.T) {
	var buf bytes.Buffer
	if err := writeProxyHeader(writerConn{&buf}, dialReq{Net: "tcp", Target: "127.0.0.1:1"}); err != nil || buf.Len() != 0 {
		t.Errorf("wrote %d bytes, err %v; want nothing", buf.Len(), err)
	}
	if err := writeProxyHeader(writerConn{&buf}, dialReq{Src: "5.6.7.8:1000", Dst: "[::]:443"}); err != nil {
		t.Fatal(err)
	}
	// A v4 user on a dual-stack listener still gets a v4 header.
	if buf.Bytes()[13] != 0x11 {
		t.Errorf("family byte %#x, want 0x11", buf.Bytes()[13])
	}
}

// writerConn is just enough net.Conn for writeProxyHeader.
type writerConn struct{ w *bytes.Buffer }

func (c writerConn) Write(p []byte) (int, error)      { return c.w.Write(p) }
func (writerConn) Read([]byte) (int, error)           { return 0, nil }
func (writerConn) Close() error                       { return nil }
func (writerConn) LocalAddr() net.Addr                { return nil }
func (writerConn) RemoteAddr() net.Addr               { return nil }
func (writerConn) SetDeadline(t time.Time) error      { return nil }
func (writerConn) SetReadDeadline(t time.Time) error  { return nil }
func (writerConn) SetWriteDeadline(t time.Time) error { return nil }
