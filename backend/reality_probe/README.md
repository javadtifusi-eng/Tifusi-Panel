# Tifusi Reality Probe

Measures, from a laptop on an Iranian operator, how fast each REALITY
field-test config really is, once per uTLS fingerprint — above all the upload,
which mobile operators throttle per SNI while download stays fine.

The panel's REALITY scanner opens the throwaway inbounds and hands out a
subscription link (`/api/reality/field/<token>`, valid 30 minutes). Paste that
link into the probe's page; it dials every config through an embedded Xray
client and times a delay check, a download and an upload through the tunnel.
A browser cannot do this: it cannot choose the SNI or the TLS fingerprint.

The panel image builds it (backend/Dockerfile) and serves the zip to admins
from the REALITY scanner (`GET /api/reality/probe/download`), with an "open in
the probe" link that fills the subscription in through `?sub=`.

The page is served on 127.0.0.1 only and opens by itself. `PROBE_DEBUG=1`
prints Xray's own log in the console window.

## Build

```bash
cd backend/reality_probe
docker run --rm -v "$PWD":/src -w /src -e CGO_ENABLED=0 -e GOOS=windows -e GOARCH=amd64 \
  golang:1.26 go build -trimpath -ldflags "-s -w" -o TifusiRealityProbe.exe .
```

Keep `github.com/xtls/xray-core` at the node's Xray version.
