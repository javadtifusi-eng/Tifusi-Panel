# Tifusi Reality Probe

Finds and measures REALITY targets from a laptop on an Iranian operator — above
all the upload, which mobile operators throttle per SNI while download stays
fine. The panel itself does no scanning any more; everything that depends on
the operator is measured here, on the operator.

Automatic mode (the default): paste the panel address and an admin API key
once (kept in this page's localStorage on 127.0.0.1). The probe

1. gets a page of popular names from the panel (`GET /api/reality/candidates`,
   only a list from the Tranco feed — the feed site itself may not open on the
   operator with the VPN off, the panel must),
2. TLS 1.3 + h2 handshakes each name directly from the laptop and re-times the
   40 quickest one at a time (a poisoned DNS answer, a blocked SNI or a
   throttled hello all show up here),
3. asks the panel to open field-test inbounds for the quickest few
   (`POST /api/reality/nodes/{id}/field-test`, first connected node), and
4. dials each through an embedded Xray client once per uTLS fingerprint and
   times a delay check, a download and an upload.

Manual mode still takes a field-test subscription link directly.

The panel has to be reachable from the operator without a VPN — on MCI that
means behind a domestic CDN such as Arvan. The panel image builds the probe
(backend/Dockerfile) and serves the zip at `GET /api/reality/probe/download`.

The page is served on 127.0.0.1 only and opens by itself. `PROBE_DEBUG=1`
prints Xray's own log in the console window.

## Build

```bash
cd backend/reality_probe
docker run --rm -v "$PWD":/src -w /src -e CGO_ENABLED=0 -e GOOS=windows -e GOARCH=amd64 \
  golang:1.26 go build -trimpath -ldflags "-s -w" -o TifusiRealityProbe.exe .
```

Keep `github.com/xtls/xray-core` at the node's Xray version.
