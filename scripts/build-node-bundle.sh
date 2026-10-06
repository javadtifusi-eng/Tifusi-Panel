#!/usr/bin/env bash
# Builds the offline node bundle: everything install-node.sh needs to bring a
# node up on a server that can reach neither GitHub, ghcr.io, Docker Hub nor
# an apt mirror (an Iranian server during an international shutdown).
#
# Run on the panel server, which still has open internet, from the install
# directory (`tifusi panel node-bundle` does this). The result lands in
# data/node-bundle/, where the panel serves it for download and uploads it
# over SSH from a node's "Install over SSH" sheet.
#
#   tifusi-node-offline.tar        the bundle (one folder, see layout below)
#   bundle.json                    what the panel shows: version, size, sha256
#
# Layout inside the tar (folder tifusi-node-offline/):
#   install-node.sh                same installer; finds images/ beside it and goes offline
#   images/tifusi-node-agent.tar.gz  `docker save` of the node image
#   docker/docker.tgz              Docker's static binaries (any distro, no apt)
#   debs/<codename>/*.deb          iptables/kmod/iproute2 for a minimal image lacking them
#   tunnel/tifusi-tunnel-linux-*   the reverse-tunnel binary, both arches
#   scripts/                       the `tifusi node` management command
#   VERSION  SHA256SUMS  README-fa.txt
#
# Env overrides: DOCKER_STATIC_VERSION, BUNDLE_DEB_RELEASES ("jammy noble bookworm"),
# BUNDLE_OUT_DIR, NODE_IMAGE.

set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${BUNDLE_OUT_DIR:-$SRC_DIR/data/node-bundle}"
NODE_IMAGE="${NODE_IMAGE:-ghcr.io/javadtifusi-eng/tifusi-node-agent:latest}"
# Static binaries carry their own containerd and runc, so the bundle doesn't
# depend on which distro or release the node runs.
DOCKER_STATIC_VERSION="${DOCKER_STATIC_VERSION:-28.5.2}"
DEB_RELEASES="${BUNDLE_DEB_RELEASES:-jammy noble bookworm}"
TUNNEL_RELEASE="https://github.com/javadtifusi-eng/Tifusi-Panel/releases/download/tunnel-agent"
NAME=tifusi-node-offline

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_CYAN=$'\033[1;36m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[1;31m'; C_GREEN=$'\033[1;32m'; C_RESET=$'\033[0m'
else
  C_CYAN=""; C_YELLOW=""; C_RED=""; C_GREEN=""; C_RESET=""
fi
info() { printf '%s[Bundle]%s %s\n' "$C_CYAN" "$C_RESET" "$1"; }
warn() { printf '%s[Warning]%s %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
fail() { printf '%s[Error]%s %s\n' "$C_RED" "$C_RESET" "$1"; exit 1; }

command -v docker >/dev/null 2>&1 || fail "Docker is needed on this server to export the node image."
[ -f "$SRC_DIR/install-node.sh" ] || fail "install-node.sh not found in $SRC_DIR."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/$NAME"
mkdir -p "$STAGE"/{images,docker,debs,tunnel,scripts}

info "Node image"
# Saved under whatever name it already has; the host's own tifusi-node-agent
# tag is never moved, since this panel server may run a node from it.
if docker pull -q "$NODE_IMAGE" >/dev/null 2>&1; then
  SAVE_REF="$NODE_IMAGE"
  info "  pulled $NODE_IMAGE"
elif docker image inspect tifusi-node-agent:latest >/dev/null 2>&1; then
  SAVE_REF=tifusi-node-agent:latest
  warn "  couldn't pull $NODE_IMAGE — using the tifusi-node-agent image already on this server"
elif [ ! -f "$SRC_DIR/backend/node_agent/Dockerfile" ]; then
  # An install from the public repository has no source to build from.
  fail "Couldn't pull $NODE_IMAGE and there's no local node image — check this server's access to ghcr.io and run it again."
else
  info "  no prebuilt image reachable — building it (compiles strongSwan, takes a few minutes)"
  docker build -q -t tifusi-node-agent:latest -f "$SRC_DIR/backend/node_agent/Dockerfile" "$SRC_DIR/backend" >/dev/null
  SAVE_REF=tifusi-node-agent:latest
fi
docker save "$SAVE_REF" | gzip -1 > "$STAGE/images/tifusi-node-agent.tar.gz"
echo "$SAVE_REF" > "$STAGE/images/IMAGE"
info "  $(du -h "$STAGE/images/tifusi-node-agent.tar.gz" | cut -f1) image"

info "Docker static binaries $DOCKER_STATIC_VERSION"
curl -fsSL --retry 3 -o "$STAGE/docker/docker.tgz" \
  "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_STATIC_VERSION}.tgz" \
  || fail "Couldn't download Docker $DOCKER_STATIC_VERSION (set DOCKER_STATIC_VERSION to one listed at download.docker.com/linux/static/stable/x86_64/)."
echo "$DOCKER_STATIC_VERSION" > "$STAGE/docker/VERSION"

# Docker's own daemon needs iptables on the host, and the installer uses ss/ip
# (iproute2) and modprobe (kmod). Normal server images ship all three; these
# are only installed when one is missing. Downloaded inside a container of each
# release so the package versions match what that release's dpkg expects.
for rel in $DEB_RELEASES; do
  case "$rel" in
    focal|jammy|noble) base="ubuntu:$rel" ;;
    bullseye|bookworm|trixie) base="debian:$rel" ;;
    *) warn "  unknown release '$rel', skipped"; continue ;;
  esac
  mkdir -p "$STAGE/debs/$rel"
  if docker run --rm -v "$STAGE/debs/$rel:/out" "$base" sh -c '
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq >/dev/null &&
      apt-get install -y -qq --download-only --no-install-recommends iptables kmod iproute2 >/dev/null &&
      cp /var/cache/apt/archives/*.deb /out/ 2>/dev/null; chmod 644 /out/*.deb 2>/dev/null; true' >/dev/null 2>&1 \
    && ls "$STAGE/debs/$rel"/*.deb >/dev/null 2>&1; then
    info "  debs for $rel: $(ls "$STAGE/debs/$rel" | wc -l) packages"
  else
    rm -rf "${STAGE:?}/debs/$rel"
    warn "  couldn't fetch debs for $rel — skipped (only matters on an image without iptables)"
  fi
done

info "Tunnel binaries"
for arch in amd64 arm64; do
  if ! curl -fsSL --retry 3 -o "$STAGE/tunnel/tifusi-tunnel-linux-$arch" "$TUNNEL_RELEASE/tifusi-tunnel-linux-$arch"; then
    rm -f "$STAGE/tunnel/tifusi-tunnel-linux-$arch"
    warn "  couldn't download tifusi-tunnel-linux-$arch — tunnels will need their own offline bundle"
  fi
done
chmod 755 "$STAGE"/tunnel/* 2>/dev/null || true

cp "$SRC_DIR/install-node.sh" "$STAGE/install-node.sh"
chmod 755 "$STAGE/install-node.sh"
for f in install-commands.sh manage-node.sh tifusi; do
  cp "$SRC_DIR/scripts/$f" "$STAGE/scripts/$f"
done
VERSION="$(cat "$SRC_DIR/backend/VERSION" 2>/dev/null || echo unknown)"
echo "$VERSION" > "$STAGE/VERSION"

cat > "$STAGE/README-fa.txt" <<EOF
تیفوسی — بستهٔ نصب آفلاین نود (نسخهٔ $VERSION)

برای سروری که به گیت‌هاب، داکر هاب و مخازن apt دسترسی نداره. هیچ دانلودی لازم نیست.

راه ۱ (پیشنهادی): از صفحهٔ Nodes پنل، دکمهٔ SSH ← «نصب خودکار». پنل خودش این بسته رو
می‌فرسته و نصب می‌کنه.

راه ۲ (دستی):
  scp $NAME.tar root@IP-SERVER:/root/
  ssh root@IP-SERVER
  cd /root && tar xf $NAME.tar && cd $NAME
  bash install-node.sh <API_KEY> [PORT]

کلید API رو از صفحهٔ Nodes پنل (دکمهٔ «دستور نصب») بردار.
مدیریت بعد از نصب:  tifusi node
EOF

(cd "$STAGE" && find . -type f ! -name SHA256SUMS -printf '%P\n' | sort | xargs -d '\n' sha256sum > SHA256SUMS)

mkdir -p "$OUT_DIR"
# Written beside the live copy and renamed over it, so a download or an SSH
# upload running right now keeps reading a whole file.
tar -C "$WORK" -cf "$OUT_DIR/$NAME.tar.part" "$NAME"
mv -f "$OUT_DIR/$NAME.tar.part" "$OUT_DIR/$NAME.tar"
SHA=$(sha256sum "$OUT_DIR/$NAME.tar" | cut -d' ' -f1)
SIZE=$(stat -c %s "$OUT_DIR/$NAME.tar")
DEBS=$(cd "$STAGE/debs" && ls -d -- * 2>/dev/null | paste -sd, - || true)
TUNNEL=$(cd "$STAGE/tunnel" && ls 2>/dev/null | sed 's/tifusi-tunnel-linux-//' | paste -sd, - || true)
python3 - "$OUT_DIR/bundle.json" <<EOF 2>/dev/null || printf '{"file":"%s.tar","version":"%s","size":%s,"sha256":"%s","built_at":"%s","docker":"%s"}\n' "$NAME" "$VERSION" "$SIZE" "$SHA" "$(date -u +%FT%TZ)" "$DOCKER_STATIC_VERSION" > "$OUT_DIR/bundle.json"
import json, sys
json.dump({
    "file": "$NAME.tar",
    "version": "$VERSION",
    "size": $SIZE,
    "sha256": "$SHA",
    "built_at": "$(date -u +%FT%TZ)",
    "docker": "$DOCKER_STATIC_VERSION",
    "debs": [r for r in "$DEBS".split(",") if r],
    "tunnel_arches": [a for a in "$TUNNEL".split(",") if a],
}, open(sys.argv[1], "w"))
EOF
chmod 644 "$OUT_DIR/$NAME.tar" "$OUT_DIR/bundle.json"

printf '\n%s✔ Offline node bundle ready%s\n' "$C_GREEN" "$C_RESET"
printf '  File    : %s (%s MB)\n' "$OUT_DIR/$NAME.tar" "$((SIZE / 1048576))"
printf '  SHA256  : %s\n' "$SHA"
printf '  Panel   : Nodes → SSH → Install, or download it from the same sheet\n'
