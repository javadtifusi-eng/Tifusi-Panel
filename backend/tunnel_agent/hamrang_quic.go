package main

// Hamrang over QUIC: the same camouflage idea as Hamrang (look like ordinary
// traffic to a permitted domestic host), carried on QUIC with the "h3" ALPN so
// on the wire it is an HTTP/3 session on UDP — the protocol modern browsers
// and apps already use for big domestic sites. Each physical tunnel link is
// one QUIC connection carrying one bidirectional stream; the tunnel's own
// hello/mux framing runs on that stream exactly as it does over TCP, so no
// WebSocket layer is needed (QUIC already frames and encrypts).

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"sync"
	"time"

	"github.com/quic-go/quic-go"
)

const hamrangALPN = "h3"

func hamrangQUICConfig() *quic.Config {
	return &quic.Config{
		KeepAlivePeriod:      15 * time.Second,
		MaxIdleTimeout:       60 * time.Second,
		HandshakeIdleTimeout: 15 * time.Second,
		// Large windows so one stream can carry a whole mux of user traffic.
		InitialStreamReceiveWindow:     4 << 20,
		MaxStreamReceiveWindow:         16 << 20,
		InitialConnectionReceiveWindow: 8 << 20,
		MaxConnectionReceiveWindow:     32 << 20,
	}
}

// quicStreamConn presents one QUIC stream (plus its connection) as a net.Conn.
type quicStreamConn struct {
	quic.Stream
	conn      quic.Connection
	closeOnce sync.Once
}

func (c *quicStreamConn) LocalAddr() net.Addr  { return c.conn.LocalAddr() }
func (c *quicStreamConn) RemoteAddr() net.Addr { return c.conn.RemoteAddr() }

// Close closes our end gracefully. Stream.Close() sends a FIN so every byte we
// have written is delivered, rather than being discarded — an abrupt
// CloseWithError on the connection would drop stream data still in flight. The
// underlying QUIC connection is then torn down only after the peer's FIN has
// been drained (both sides done) or a short linger elapses, so a bulk transfer
// finishing right before Close still arrives intact.
func (c *quicStreamConn) Close() error {
	c.closeOnce.Do(func() {
		c.Stream.Close() // FIN our write side; queued data is still delivered
		go func() {
			// Drain whatever the peer sends until its FIN (io.EOF) or the
			// linger fires, then drop the connection.
			drained := make(chan struct{})
			go func() {
				buf := make([]byte, 32*1024)
				for {
					if _, err := c.Stream.Read(buf); err != nil {
						break
					}
				}
				close(drained)
			}()
			select {
			case <-drained:
			case <-time.After(10 * time.Second):
			}
			c.Stream.CancelRead(0)
			c.conn.CloseWithError(0, "")
		}()
	})
	return nil
}

// quicListener adapts a QUIC listener to net.Listener: every accepted QUIC
// connection yields its first stream as one net.Conn. Stream acceptance runs
// per connection so a peer that connects but never opens a stream cannot stall
// the accept loop.
type quicListener struct {
	ql     *quic.Listener
	conns  chan net.Conn
	errc   chan error
	ctx    context.Context
	cancel context.CancelFunc
}

func hamrangListenQUIC(addr, sni string) (net.Listener, error) {
	base, err := tlsServerConfig(sni)
	if err != nil {
		return nil, err
	}
	tc := base.Clone()
	tc.MinVersion = tls.VersionTLS13
	tc.NextProtos = []string{hamrangALPN}
	ql, err := quic.ListenAddr(addr, tc, hamrangQUICConfig())
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	l := &quicListener{ql: ql, conns: make(chan net.Conn, 64), errc: make(chan error, 1), ctx: ctx, cancel: cancel}
	go l.loop()
	return l, nil
}

func (l *quicListener) loop() {
	for {
		qc, err := l.ql.Accept(l.ctx)
		if err != nil {
			select {
			case l.errc <- err:
			default:
			}
			return
		}
		go func(qc quic.Connection) {
			sctx, cancel := context.WithTimeout(l.ctx, 20*time.Second)
			defer cancel()
			st, err := qc.AcceptStream(sctx)
			if err != nil {
				qc.CloseWithError(0, "")
				return
			}
			select {
			case l.conns <- &quicStreamConn{Stream: st, conn: qc}:
			case <-l.ctx.Done():
				qc.CloseWithError(0, "")
			}
		}(qc)
	}
}

func (l *quicListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.conns:
		return c, nil
	case err := <-l.errc:
		return nil, err
	case <-l.ctx.Done():
		return nil, net.ErrClosed
	}
}

func (l *quicListener) Close() error {
	l.cancel()
	return l.ql.Close()
}

func (l *quicListener) Addr() net.Addr { return l.ql.Addr() }

// hamrangDialQUIC opens one QUIC connection to addr presenting the camouflage
// SNI with the h3 ALPN, and returns its first stream as a net.Conn. The tunnel
// is authenticated by the shared token, so the self-signed certificate is not
// verified (as on every other TLS path).
func hamrangDialQUIC(addr, sni string, timeout time.Duration) (net.Conn, error) {
	if sni == "" {
		return nil, errors.New("hamrang: a camouflage SNI is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	tc := &tls.Config{
		ServerName:         sni,
		InsecureSkipVerify: true,
		NextProtos:         []string{hamrangALPN},
		MinVersion:         tls.VersionTLS13,
	}
	qc, err := quic.DialAddr(ctx, addr, tc, hamrangQUICConfig())
	if err != nil {
		return nil, err
	}
	st, err := qc.OpenStreamSync(ctx)
	if err != nil {
		qc.CloseWithError(0, "")
		return nil, err
	}
	return &quicStreamConn{Stream: st, conn: qc}, nil
}
