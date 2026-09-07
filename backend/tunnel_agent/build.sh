#!/usr/bin/env bash
# Build release binaries, then upload dist/* to a GitHub release named "latest"
# so install.sh can fetch them instead of compiling on every server.
set -euo pipefail

mkdir -p dist
for arch in amd64 arm64; do
  echo "building linux/$arch"
  CGO_ENABLED=0 GOOS=linux GOARCH=$arch \
    go build -trimpath -ldflags "-s -w" -o "dist/tifusi-linux-$arch" .
done
ls -lh dist
