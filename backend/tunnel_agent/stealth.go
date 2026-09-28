package main

// stealth.go is the "tcpstealth" transport: tcpmux with every byte on the
// wire encrypted and shaped, so a filter looking at the link sees nothing it
// can match.
//
// Plain tcpmux opens with a JSON hello that carries the token in clear text,
// and its frames have fixed headers and sizes. Here each direction instead
// starts with a random 32-byte salt, and everything after it is a stream of
// ChaCha20-Poly1305 chunks (counter nonces) keyed from the shared Token and
// that salt:
//
//	salt(32) | seal(len(2)) | seal([ts(8) first client chunk only] len(2) data pad) | ...
//
// Every chunk carries random padding, heavier on the first few so the
// handshake has no fixed size. The server never sends a byte before a valid
// client chunk, and a connection that fails authentication, replays a salt
// or carries a stale timestamp is not closed straight away: it is read and
// discarded for a random while, like a service still waiting for input. An
// active probe therefore gets neither an error nor an answer.

import (
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"
	"math/big"
	"net"
	"sync"
	"time"

	"golang.org/x/crypto/chacha20poly1305"
)

const (
	stealthSaltLen   = 32
	stealthMaxData   = 16 * 1024
	stealthTagLen    = chacha20poly1305.Overhead
	stealthHeaderLen = 2 + stealthTagLen
	stealthTSLen     = 8
	// How far a client's clock may be off, and how long a salt is
	// remembered; the cache outlives the window so a replay can't slip in
	// once its salt is forgotten.
	stealthClockSkew = 2 * time.Minute
	stealthSaltTTL   = 5 * time.Minute
	// Heavier padding on each side's first chunks hides the handshake sizes.
	stealthShapedChunks = 8
)

var errStealthAuth = errors.New("stealth: authentication failed")

func stealthKey(token string) []byte {
	sum := sha256.Sum256([]byte("tifusi-stealth|" + token))
	return sum[:]
}

// stealthSubkey derives one direction's key: HMAC-SHA256 keyed by the master
// key over the salt and a direction label, so the two directions never share
// a key even though both ends start from the same Token.
func stealthSubkey(master, salt []byte, dir string) []byte {
	m := hmac.New(sha256.New, master)
	m.Write(salt)
	m.Write([]byte(dir))
	return m.Sum(nil)
}

// saltCache remembers recent client salts so a recorded handshake can't be
// replayed to learn what the server answers.
type saltCache struct {
	mu   sync.Mutex
	seen map[[stealthSaltLen]byte]time.Time
	last time.Time
}

var stealthSalts = &saltCache{seen: map[[stealthSaltLen]byte]time.Time{}}

// add reports false if the salt was already used.
func (c *saltCache) add(salt []byte, now time.Time) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if now.Sub(c.last) > time.Minute {
		for k, t := range c.seen {
			if now.Sub(t) > stealthSaltTTL {
				delete(c.seen, k)
			}
		}
		c.last = now
	}
	var k [stealthSaltLen]byte
	copy(k[:], salt)
	if _, dup := c.seen[k]; dup {
		return false
	}
	c.seen[k] = now
	return true
}

func randIntn(n int) int {
	if n <= 0 {
		return 0
	}
	v, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		return 0
	}
	return int(v.Int64())
}

type stealthConn struct {
	net.Conn
	master []byte
	server bool

	rmu     sync.Mutex
	raead   cipher.AEAD
	rnonce  [chacha20poly1305.NonceSize]byte
	rbuf    []byte
	rchunks int

	wmu     sync.Mutex
	waead   cipher.AEAD
	wnonce  [chacha20poly1305.NonceSize]byte
	wchunks int
}

func newStealthConn(c net.Conn, token string, server bool) *stealthConn {
	return &stealthConn{Conn: c, master: stealthKey(token), server: server}
}

func (c *stealthConn) dirs() (write, read string) {
	if c.server {
		return "s2c", "c2s"
	}
	return "c2s", "s2c"
}

func incNonce(n *[chacha20poly1305.NonceSize]byte) {
	for i := range n {
		n[i]++
		if n[i] != 0 {
			return
		}
	}
}

func (c *stealthConn) Write(p []byte) (int, error) {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	var out []byte
	if c.waead == nil {
		salt := make([]byte, stealthSaltLen)
		if _, err := rand.Read(salt); err != nil {
			return 0, err
		}
		wdir, _ := c.dirs()
		aead, err := chacha20poly1305.New(stealthSubkey(c.master, salt, wdir))
		if err != nil {
			return 0, err
		}
		c.waead = aead
		out = append(out, salt...)
	}
	n := 0
	for {
		chunk := p
		if len(chunk) > stealthMaxData {
			chunk = chunk[:stealthMaxData]
		}
		out = c.sealChunk(out, chunk)
		n += len(chunk)
		p = p[len(chunk):]
		if len(p) == 0 {
			break
		}
	}
	if _, err := c.Conn.Write(out); err != nil {
		return 0, err
	}
	return n, nil
}

func (c *stealthConn) sealChunk(out, data []byte) []byte {
	pad := randIntn(64)
	if c.wchunks < stealthShapedChunks {
		pad = 16 + randIntn(496)
	}
	var plain []byte
	if !c.server && c.wchunks == 0 {
		plain = binary.BigEndian.AppendUint64(plain, uint64(time.Now().Unix()))
	}
	plain = binary.BigEndian.AppendUint16(plain, uint16(len(data)))
	plain = append(plain, data...)
	padding := make([]byte, pad)
	rand.Read(padding)
	plain = append(plain, padding...)

	var hdr [2]byte
	binary.BigEndian.PutUint16(hdr[:], uint16(len(plain)))
	out = c.waead.Seal(out, c.wnonce[:], hdr[:], nil)
	incNonce(&c.wnonce)
	out = c.waead.Seal(out, c.wnonce[:], plain, nil)
	incNonce(&c.wnonce)
	c.wchunks++
	return out
}

func (c *stealthConn) Read(p []byte) (int, error) {
	c.rmu.Lock()
	defer c.rmu.Unlock()
	for len(c.rbuf) == 0 {
		data, err := c.readChunk()
		if err != nil {
			if c.server && c.rchunks == 0 && errors.Is(err, errStealthAuth) {
				c.stall()
			}
			return 0, err
		}
		c.rbuf = data
	}
	n := copy(p, c.rbuf)
	c.rbuf = c.rbuf[n:]
	return n, nil
}

func (c *stealthConn) readChunk() ([]byte, error) {
	if c.raead == nil {
		salt := make([]byte, stealthSaltLen)
		if _, err := io.ReadFull(c.Conn, salt); err != nil {
			return nil, err
		}
		if c.server && !stealthSalts.add(salt, time.Now()) {
			return nil, errStealthAuth
		}
		_, rdir := c.dirs()
		aead, err := chacha20poly1305.New(stealthSubkey(c.master, salt, rdir))
		if err != nil {
			return nil, err
		}
		c.raead = aead
	}
	var hdr [stealthHeaderLen]byte
	if _, err := io.ReadFull(c.Conn, hdr[:]); err != nil {
		return nil, err
	}
	lenb, err := c.raead.Open(nil, c.rnonce[:], hdr[:], nil)
	if err != nil {
		return nil, errStealthAuth
	}
	incNonce(&c.rnonce)
	body := make([]byte, int(binary.BigEndian.Uint16(lenb))+stealthTagLen)
	if _, err := io.ReadFull(c.Conn, body); err != nil {
		return nil, err
	}
	plain, err := c.raead.Open(body[:0], c.rnonce[:], body, nil)
	if err != nil {
		return nil, errStealthAuth
	}
	incNonce(&c.rnonce)
	if c.server && c.rchunks == 0 {
		if len(plain) < stealthTSLen {
			return nil, errStealthAuth
		}
		ts := time.Unix(int64(binary.BigEndian.Uint64(plain)), 0)
		if d := time.Since(ts); d > stealthClockSkew || d < -stealthClockSkew {
			return nil, errStealthAuth
		}
		plain = plain[stealthTSLen:]
	}
	if len(plain) < 2 {
		return nil, errStealthAuth
	}
	n := int(binary.BigEndian.Uint16(plain))
	if n > len(plain)-2 {
		return nil, errStealthAuth
	}
	c.rchunks++
	return plain[2 : 2+n], nil
}

// stall keeps a failed connection open and silent for a random while, then
// lets the caller close it, so a probe can't tell this port from one whose
// service is simply waiting for more input.
func (c *stealthConn) stall() {
	c.Conn.SetReadDeadline(time.Now().Add(time.Duration(20+randIntn(70)) * time.Second))
	io.Copy(io.Discard, c.Conn)
}

// stealthListener wraps every accepted connection; the handshake itself
// happens lazily on the first Read, in the connection's own goroutine, so a
// slow or hostile client never blocks Accept.
type stealthListener struct {
	net.Listener
	token string
}

func (l stealthListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return newStealthConn(c, l.token, true), nil
}
