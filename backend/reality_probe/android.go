package main

import (
	"context"
	"net"
	"os"
	"time"

	// Mozilla's roots, used only when the system has none of its own: Termux
	// on Android keeps no CA bundle where Go looks for one.
	_ "golang.org/x/crypto/x509roots/fallback"
)

// Android has no /etc/resolv.conf, so Go's resolver would ask 127.0.0.1:53
// and fail. Ask public resolvers instead whenever that file is missing.
func init() {
	if _, err := os.Stat("/etc/resolv.conf"); err == nil {
		return
	}
	servers := []string{"8.8.8.8:53", "1.1.1.1:53", "9.9.9.9:53"}
	net.DefaultResolver = &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			d := net.Dialer{Timeout: 4 * time.Second}
			var last error
			for _, s := range servers {
				c, err := d.DialContext(ctx, network, s)
				if err == nil {
					return c, nil
				}
				last = err
			}
			return nil, last
		},
	}
}
