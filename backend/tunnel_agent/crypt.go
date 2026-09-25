package main

// crypt.go adds confidentiality, integrity and traffic-shape obfuscation to
// the packet-based transports (udp and spoof). Both tunnel ends are generated
// from the same panel config, so they share the same Token; every key here is
// derived from that Token, which keeps the two ends symmetric without shipping
// a separate secret.
//
// Two layers are provided:
//
//   - newKCPBlock: an AES-256 BlockCrypt for the "udp" transport, plugged into
//     kcp's own crypto slot. It encrypts every KCP segment.
//
//   - obfPacketConn: an AEAD wrapper (XChaCha20-Poly1305) for the "spoof"
//     transport. Unlike a plain block cipher it authenticates every datagram,
//     so a forged or tampered packet is dropped instead of fed to KCP, and it
//     pads each datagram by a random amount so a filter can't fingerprint the
//     tunnel by its fixed packet sizes.

import (
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"net"
	"sync"
	"time"

	kcp "github.com/xtaci/kcp-go/v5"
	"golang.org/x/crypto/chacha20poly1305"
	"golang.org/x/crypto/pbkdf2"
)

// deriveKey stretches the shared token into a 32-byte key. The salt binds the
// key to a purpose, so the udp block cipher and the spoof AEAD never end up
// using the same bytes even with the same token.
func deriveKey(token, salt string) []byte {
	return pbkdf2.Key([]byte(token), []byte("tifusi-tunnel|"+salt), 4096, 32, sha256.New)
}

// newKCPBlock builds the AES-256 BlockCrypt used to encrypt the "udp"
// transport's KCP segments.
func newKCPBlock(token string) (kcp.BlockCrypt, error) {
	return kcp.NewAESBlockCrypt(deriveKey(token, "udp-kcp"))
}

// maxPad is the largest random padding (in bytes) added to a spoof datagram.
// Small enough not to matter for throughput, large enough that packet sizes
// stop being a stable signature.
const maxPad = 32

// obfPacketConn wraps a net.PacketConn and seals every datagram with an AEAD
// plus random padding. It is used on the spoof transport, between KCP and the
// raw source-spoofing conn.
type obfPacketConn struct {
	inner net.PacketConn
	aead  interface {
		Seal(dst, nonce, plaintext, additionalData []byte) []byte
		Open(dst, nonce, ciphertext, additionalData []byte) ([]byte, error)
		NonceSize() int
		Overhead() int
	}
	rbuf []byte
	rmu  sync.Mutex
}

func newObfPacketConn(inner net.PacketConn, token string) (*obfPacketConn, error) {
	aead, err := chacha20poly1305.NewX(deriveKey(token, "spoof-aead"))
	if err != nil {
		return nil, err
	}
	return &obfPacketConn{
		inner: inner,
		aead:  aead,
		rbuf:  make([]byte, 65535),
	}, nil
}

// WriteTo seals p (with a 1-byte pad length, the payload, then that many
// random pad bytes) under a fresh random nonce and sends nonce||ciphertext.
func (c *obfPacketConn) WriteTo(p []byte, addr net.Addr) (int, error) {
	ns := c.aead.NonceSize()
	nonce := make([]byte, ns)
	if _, err := rand.Read(nonce); err != nil {
		return 0, err
	}
	var padByte [1]byte
	if _, err := rand.Read(padByte[:]); err != nil {
		return 0, err
	}
	padLen := int(padByte[0]) % (maxPad + 1)

	plain := make([]byte, 1+len(p)+padLen)
	plain[0] = byte(padLen)
	copy(plain[1:], p)
	if padLen > 0 {
		if _, err := rand.Read(plain[1+len(p):]); err != nil {
			return 0, err
		}
	}

	wire := make([]byte, ns, ns+len(plain)+c.aead.Overhead())
	copy(wire, nonce)
	wire = c.aead.Seal(wire, nonce, plain, nil)
	if _, err := c.inner.WriteTo(wire, addr); err != nil {
		return 0, err
	}
	return len(p), nil
}

// ReadFrom reads one sealed datagram, drops it on any authentication failure
// and reads again, so garbage or forged packets never reach KCP.
func (c *obfPacketConn) ReadFrom(p []byte) (int, net.Addr, error) {
	ns := c.aead.NonceSize()
	c.rmu.Lock()
	defer c.rmu.Unlock()
	for {
		n, addr, err := c.inner.ReadFrom(c.rbuf)
		if err != nil {
			return 0, addr, err
		}
		if n < ns+c.aead.Overhead()+1 {
			continue // too short to be one of ours
		}
		plain, err := c.aead.Open(nil, c.rbuf[:ns], c.rbuf[ns:n], nil)
		if err != nil {
			continue // failed auth: not ours, or tampered
		}
		padLen := int(plain[0])
		if 1+padLen > len(plain) {
			continue // malformed
		}
		payload := plain[1 : len(plain)-padLen]
		copy(p, payload)
		return len(payload), addr, nil
	}
}

func (c *obfPacketConn) Close() error                       { return c.inner.Close() }
func (c *obfPacketConn) LocalAddr() net.Addr                { return c.inner.LocalAddr() }
func (c *obfPacketConn) SetDeadline(t time.Time) error      { return c.inner.SetDeadline(t) }
func (c *obfPacketConn) SetReadDeadline(t time.Time) error  { return c.inner.SetReadDeadline(t) }
func (c *obfPacketConn) SetWriteDeadline(t time.Time) error { return c.inner.SetWriteDeadline(t) }

var errNoSpoofSources = errors.New("spoof transport needs at least one forged source IP")
