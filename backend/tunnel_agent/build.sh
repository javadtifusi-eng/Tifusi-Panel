#!/usr/bin/env bash
# Build release binaries into dist/. The build-tunnel-agent workflow runs this and
# publishes dist/* on the "tunnel-agent" release, which install.sh downloads from
# so servers never have to compile the agent themselves.
set -euo pipefail

mkdir -p dist
for arch in amd64 arm64; do
  echo "building linux/$arch"
  CGO_ENABLED=0 GOOS=linux GOARCH=$arch \
    go build -trimpath -ldflags "-s -w" -o "dist/tifusi-tunnel-linux-$arch" .
done
ls -lh dist
