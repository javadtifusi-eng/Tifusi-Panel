package main

// proxyproto.go passes the user's real address through a TCP forward with the
// PROXY protocol, version 2 (the binary header HAProxy defined, which Xray,
// nginx and HAProxy read). Without it every connection reaches the service
// from the tunnel itself, so a panel that tells devices apart by address —
// Tifusi's Xray device limit does — sees one device for every user behind
// the relay.
//
// The Iran side knows the address: it accepted the connection. It sends it
// with the dial request, and the foreign side writes the header as the first
// bytes on the connection it opens to the target. The target must be set to
// expect it (acceptProxyProtocol in Xray); a service that isn't would read
// the header as garbage, which is why it is a per-forward switch.

import (
	"encoding/binary"
	"errors"
	"net"
)

// proxyV2Sig is the fixed 12-byte signature every v2 header starts with.
var proxyV2Sig = []byte{0x0D, 0x0A, 0x0D, 0x0A, 0x00, 0x0D, 0x0A, 0x51, 0x55, 0x49, 0x54, 0x0A}

// buildProxyV2 returns the PROXY v2 header announcing a TCP connection from
// src to dst. Both must be the same family.
func buildProxyV2(src, dst *net.TCPAddr) ([]byte, error) {
	if src == nil || dst == nil {
		return nil, errors.New("proxy protocol: missing address")
	}
	h := append([]byte{}, proxyV2Sig...)
	h = append(h, 0x21) // version 2, command PROXY
	if s4, d4 := src.IP.To4(), dst.IP.To4(); s4 != nil && d4 != nil {
		h = append(h, 0x11) // AF_INET, STREAM
		h = binary.BigEndian.AppendUint16(h, 12)
		h = append(h, s4...)
		h = append(h, d4...)
	} else if s16, d16 := src.IP.To16(), dst.IP.To16(); s16 != nil && d16 != nil && s4 == nil && d4 == nil {
		h = append(h, 0x21) // AF_INET6, STREAM
		h = binary.BigEndian.AppendUint16(h, 36)
		h = append(h, s16...)
		h = append(h, d16...)
	} else {
		return nil, errors.New("proxy protocol: source and destination are different address families")
	}
	h = binary.BigEndian.AppendUint16(h, uint16(src.Port))
	h = binary.BigEndian.AppendUint16(h, uint16(dst.Port))
	return h, nil
}

// proxyAddrs is what the Iran side puts in a dial request for a forward with
// proxy_protocol on: the user's address and the one they connected to.
func proxyAddrs(fw Forward, c net.Conn) (src, dst string) {
	if !fw.ProxyProtocol || c == nil {
		return "", ""
	}
	return c.RemoteAddr().String(), c.LocalAddr().String()
}

// writeProxyHeader sends the PROXY v2 header for a dial request that carries
// the user's address, before any of the user's own bytes. A request without
// one (proxy_protocol off, or an Iran side from before it) writes nothing.
func writeProxyHeader(target net.Conn, req dialReq) error {
	if req.Src == "" {
		return nil
	}
	src, err := net.ResolveTCPAddr("tcp", req.Src)
	if err != nil {
		return err
	}
	dst, err := net.ResolveTCPAddr("tcp", req.Dst)
	if err != nil {
		return err
	}
	// A v4 user on a dual-stack listener shows up as ::ffff:a.b.c.d; To4
	// folds it back so both ends are the same family.
	if src.IP.To4() != nil && dst.IP.To4() == nil {
		dst.IP = net.IPv4zero
	}
	if dst.IP.To4() != nil && src.IP.To4() == nil {
		src.IP = net.IPv4zero
	}
	h, err := buildProxyV2(src, dst)
	if err != nil {
		return err
	}
	_, err = target.Write(h)
	return err
}
