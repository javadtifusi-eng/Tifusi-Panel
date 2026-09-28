package main

import (
	"bytes"
	"crypto/rand"
	"io"
	"net"
	"testing"
	"time"
)

func stealthPair(t *testing.T, token string) (client *stealthConn, server net.Conn, raw net.Conn) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	sl := stealthListener{Listener: ln, token: token}
	accepted := make(chan net.Conn, 1)
	go func() {
		c, err := sl.Accept()
		if err == nil {
			accepted <- c
		}
	}()
	raw, err = net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { raw.Close() })
	select {
	case server = <-accepted:
	case <-time.After(5 * time.Second):
		t.Fatal("accept timed out")
	}
	t.Cleanup(func() { server.Close() })
	return newStealthConn(raw, token, false), server, raw
}

func TestStealthRoundTrip(t *testing.T) {
	client, server, _ := stealthPair(t, "test-token-123")
	big := make([]byte, 100*1024) // spans several chunks
	rand.Read(big)
	msgs := [][]byte{[]byte(`{"hello":1}` + "\n"), big, {}}

	go func() {
		for _, m := range msgs {
			if _, err := client.Write(m); err != nil {
				t.Error(err)
				return
			}
		}
	}()
	want := append(append([]byte{}, msgs[0]...), big...)
	got := make([]byte, len(want))
	server.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := io.ReadFull(server, got); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("server read different bytes than the client wrote")
	}

	go server.Write([]byte("reply"))
	reply := make([]byte, 5)
	client.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := io.ReadFull(client, reply); err != nil || string(reply) != "reply" {
		t.Fatalf("reply %q, %v", reply, err)
	}
}

func TestStealthNoPlaintextOnWire(t *testing.T) {
	// Capture what the client sends by writing into a pipe.
	a, b := net.Pipe()
	defer a.Close()
	defer b.Close()
	c := newStealthConn(a, "test-token-123", false)
	payload := []byte(`{"ver":"1.0.0","token":"test-token-123","role":"mux"}` + "\n")
	go c.Write(payload)
	buf := make([]byte, 4096)
	b.SetReadDeadline(time.Now().Add(2 * time.Second))
	n, _ := b.Read(buf)
	wire := buf[:n]
	if bytes.Contains(wire, []byte("token")) || bytes.Contains(wire, []byte("test-token-123")) {
		t.Fatal("hello visible on the wire")
	}
	if n < stealthSaltLen+stealthHeaderLen+len(payload) {
		t.Fatalf("first write too short: %d bytes", n)
	}
}

func TestStealthProbeGetsNoAnswer(t *testing.T) {
	_, server, raw := stealthPair(t, "test-token-123")
	junk := make([]byte, 200)
	rand.Read(junk)
	raw.Write(junk)

	readErr := make(chan error, 1)
	go func() {
		_, err := server.Read(make([]byte, 10))
		readErr <- err
	}()
	// The server must neither answer nor hang up while it stalls.
	raw.SetReadDeadline(time.Now().Add(1500 * time.Millisecond))
	n, err := raw.Read(make([]byte, 10))
	if n != 0 {
		t.Fatalf("probe got %d bytes back", n)
	}
	if ne, ok := err.(net.Error); !ok || !ne.Timeout() {
		t.Fatalf("probe connection was closed early: %v", err)
	}
	select {
	case err := <-readErr:
		t.Fatalf("server gave up on the probe too soon: %v", err)
	default:
	}
}

func TestStealthWrongTokenRejected(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	sl := stealthListener{Listener: ln, token: "server-token-1"}
	go func() {
		c, _ := net.Dial("tcp", ln.Addr().String())
		newStealthConn(c, "other-token-2", false).Write([]byte("hello\n"))
		time.Sleep(3 * time.Second)
		c.Close()
	}()
	s, err := sl.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	sc := s.(*stealthConn)
	sc.rmu.Lock()
	_, err = sc.readChunk()
	sc.rmu.Unlock()
	if err != errStealthAuth {
		t.Fatalf("wrong token: got %v, want errStealthAuth", err)
	}
}

func TestStealthReplayRejected(t *testing.T) {
	a, b := net.Pipe()
	c := newStealthConn(a, "test-token-123", false)
	go c.Write([]byte("hello\n"))
	buf := make([]byte, 4096)
	b.SetReadDeadline(time.Now().Add(2 * time.Second))
	n, _ := b.Read(buf)
	a.Close()
	b.Close()
	recorded := append([]byte{}, buf[:n]...)

	replay := func() error {
		x, y := net.Pipe()
		defer x.Close()
		defer y.Close()
		go y.Write(recorded)
		s := newStealthConn(x, "test-token-123", true)
		s.rmu.Lock()
		defer s.rmu.Unlock()
		_, err := s.readChunk()
		return err
	}
	if err := replay(); err != nil {
		t.Fatalf("first delivery rejected: %v", err)
	}
	if err := replay(); err != errStealthAuth {
		t.Fatalf("replay: got %v, want errStealthAuth", err)
	}
}

func freeAddr(t *testing.T, network string) string {
	t.Helper()
	if network == "udp" {
		c, err := net.ListenPacket("udp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close()
		return c.LocalAddr().String()
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().String()
}

// TestStealthTunnelEndToEnd runs a real server and client over tcpstealth and
// pushes TCP and UDP through a forward each.
func TestStealthTunnelEndToEnd(t *testing.T) {
	echoTCP, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer echoTCP.Close()
	go func() {
		for {
			c, err := echoTCP.Accept()
			if err != nil {
				return
			}
			go func() { io.Copy(c, c); c.Close() }()
		}
	}()
	echoUDP, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer echoUDP.Close()
	go func() {
		buf := make([]byte, 2048)
		for {
			n, a, err := echoUDP.ReadFrom(buf)
			if err != nil {
				return
			}
			echoUDP.WriteTo(buf[:n], a)
		}
	}()

	tunnel := freeAddr(t, "tcp")
	fwTCP := freeAddr(t, "tcp")
	fwUDP := freeAddr(t, "udp")
	srv := &Config{Mode: "server", Listen: tunnel, Transport: "tcpstealth", Token: "e2e-token-12345", StatusListen: "off",
		Forwards: []Forward{
			{Listen: fwTCP, Net: "tcp", Target: echoTCP.Addr().String()},
			{Listen: fwUDP, Net: "udp", Target: echoUDP.LocalAddr().String()},
		}}
	cli := &Config{Mode: "client", Server: tunnel, Transport: "tcpstealth", Token: "e2e-token-12345", StatusListen: "off", MuxCon: 2}
	for _, c := range []*Config{srv, cli} {
		c.applyDefaults()
		if err := c.validate(); err != nil {
			t.Fatal(err)
		}
	}
	go (&Server{cfg: srv, pool: make(chan *dataConn, 512)}).Run()
	go (&Client{cfg: cli}).Run()

	msg := make([]byte, 64*1024)
	rand.Read(msg)
	deadline := time.Now().Add(15 * time.Second)
	for {
		c, err := net.Dial("tcp", fwTCP)
		if err == nil {
			c.SetDeadline(time.Now().Add(3 * time.Second))
			go c.Write(msg)
			got := make([]byte, len(msg))
			_, err = io.ReadFull(c, got)
			c.Close()
			if err == nil {
				if !bytes.Equal(got, msg) {
					t.Fatal("tcp echo through tcpstealth came back different")
				}
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("tcp through tcpstealth never worked: %v", err)
		}
		time.Sleep(300 * time.Millisecond)
	}

	u, err := net.Dial("udp", fwUDP)
	if err != nil {
		t.Fatal(err)
	}
	defer u.Close()
	for i := 0; ; i++ {
		u.Write([]byte("ping-udp"))
		u.SetReadDeadline(time.Now().Add(time.Second))
		buf := make([]byte, 64)
		n, err := u.Read(buf)
		if err == nil && string(buf[:n]) == "ping-udp" {
			break
		}
		if i > 10 {
			t.Fatalf("udp through tcpstealth never worked: %v", err)
		}
	}
}
