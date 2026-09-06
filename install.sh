#!/usr/bin/env bash
# Tifusi Panel installer — clones the repo and brings the panel up with
# Docker Compose. The admin account itself is created from the browser's
# login page, using a one-time key from `tifusi-cli generate-admin-key` —
# this script just gets the panel running and hands you that command.
#
# Usage:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install.sh)"

set -euo pipefail

REPO_URL="https://github.com/javadtifusi-eng/Tifusi-Panel.git"
INSTALL_DIR="${TIFUSI_INSTALL_DIR:-/opt/tifusi-panel}"
PANEL_URL="http://localhost:8000"

info() { printf '\033[1;36m[Tifusi]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[Warning]\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m[Error]\033[0m %s\n' "$1"; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
  info "Docker isn't installed — installing it with the official script (curl -fsSL https://get.docker.com | sh)..."
  curl -fsSL https://get.docker.com | sh
  command -v docker >/dev/null 2>&1 \
    || fail "Automatic Docker install failed — try it manually: curl -fsSL https://get.docker.com | sh"
fi
docker compose version >/dev/null 2>&1 \
  || fail "Docker is installed but the docker compose plugin isn't (or is too old) — update Docker."

if [ -f "docker-compose.yml" ] && [ -d "backend" ] && [ -d "frontend" ]; then
  INSTALL_DIR="$(pwd)"
  info "Installing from the current directory ($INSTALL_DIR)."
elif [ -d "$INSTALL_DIR/.git" ]; then
  info "Repo already exists at $INSTALL_DIR, updating it..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning the repo into $INSTALL_DIR..."
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  awk -v s="$SECRET" '{gsub(/^TIFUSI_SECRET_KEY=.*/, "TIFUSI_SECRET_KEY=" s)}1' .env > .env.tmp
  mv .env.tmp .env
  info "Generated a random TIFUSI_SECRET_KEY in .env."
fi

read -r -p "Do you have a domain name pointing at this server? [y/N] " has_domain
has_domain=${has_domain:-N}
if [[ "$has_domain" =~ ^[Yy]$ ]]; then
  read -r -p "Domain (e.g. panel.example.com): " domain
  if [ -n "$domain" ]; then
    read -r -p "Get a free Let's Encrypt certificate for it now? [Y/n] " get_cert
    get_cert=${get_cert:-Y}
    if [[ "$get_cert" =~ ^[Yy]$ ]]; then
      info "Requesting a Let's Encrypt certificate for $domain (needs port 80 free, and $domain must already resolve to this server)..."
      mkdir -p certs letsencrypt-work
      CERT_LOG="$(mktemp)"
      if docker run --rm -p 80:80 -v "$(pwd)/letsencrypt-work:/etc/letsencrypt" \
        certbot/certbot certonly --standalone --non-interactive --agree-tos \
        -m "admin@${domain}" -d "$domain" > "$CERT_LOG" 2>&1; then
        cp "letsencrypt-work/live/${domain}/fullchain.pem" certs/fullchain.pem
        cp "letsencrypt-work/live/${domain}/privkey.pem" certs/privkey.pem
        echo "TIFUSI_PUBLIC_URL=https://${domain}" >> .env
        PANEL_PUBLIC_URL="https://${domain}"
        info "Certificate obtained — the dashboard (login page) will serve HTTPS directly on $PANEL_PUBLIC_URL."
        warn "Let's Encrypt certificates expire every 90 days — this installer doesn't set up auto-renewal, so you'll need to repeat this (or set up certbot renew plus a container restart) before then."
      else
        warn "Certificate request failed — full output:"
        cat "$CERT_LOG"
        warn "Continuing without TLS (check that port 80 is free and $domain really resolves to this server's IP)."
      fi
      rm -f "$CERT_LOG"
    fi
  fi
fi
PANEL_PUBLIC_URL="${PANEL_PUBLIC_URL:-}"

info "Bringing the panel up with Docker Compose (this can take a few minutes)..."
BUILD_LOG="$(mktemp)"
if ! docker compose up -d --build > "$BUILD_LOG" 2>&1; then
  warn "Build failed — full output:"
  cat "$BUILD_LOG"
  rm -f "$BUILD_LOG"
  exit 1
fi
rm -f "$BUILD_LOG"

info "Waiting for the panel to come up..."
ready=""
for _ in $(seq 1 60); do
  if curl -fsSk "$PANEL_URL/api/setup/status" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[ -n "$ready" ] || fail "The panel didn't come up in time — check the logs: docker compose logs panel"

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST_IP="${HOST_IP:-<server-ip>}"
info "The panel is up."
if [ -n "$PANEL_PUBLIC_URL" ]; then
  info "  Dashboard:  $PANEL_PUBLIC_URL"
else
  info "  Dashboard:  http://${HOST_IP}:8080"
fi
info "  Panel API:  http://${HOST_IP}:8000"
info ""
info "To create the admin account, open the dashboard in your browser, then run this to get a one-time setup key:"
info "  docker exec -it tifusi-panel tifusi-cli generate-admin-key"
info "Paste that key into the login page along with the username/password you want, and you're in."
info "Done."
