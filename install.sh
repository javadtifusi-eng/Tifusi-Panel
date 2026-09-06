#!/usr/bin/env bash
# Tifusi Panel installer — clones the repo, brings the panel up with Docker
# Compose, then optionally creates the first admin account and a node right
# from this same terminal session, instead of a separate trip to the browser.
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

# Minimal JSON string escaping (backslash and double-quote) — enough for the
# values this script actually sends (usernames, passwords, node names), not
# a general-purpose JSON encoder.
json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# Pulls one top-level field's value out of a JSON response — tolerant of
# whether the server puts a space after the colon (grep -o '"field":"..."'
# with no space allowance silently returns nothing the moment that varies,
# which is exactly the kind of thing that only shows up once against a real
# server, not a hand-typed test payload).
json_field() {
  printf '%s' "$1" | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*(\"[^\"]*\"|[0-9]+)" | head -n1 \
    | sed -E "s/^\"$2\"[[:space:]]*:[[:space:]]*//; s/^\"//; s/\"\$//"
}

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
        {
          echo "TIFUSI_SSL_CERTFILE=/app/certs/fullchain.pem"
          echo "TIFUSI_SSL_KEYFILE=/app/certs/privkey.pem"
          echo "TIFUSI_PUBLIC_URL=https://${domain}"
        } >> .env
        sed -i 's|# - ./certs:/app/certs:ro|- ./certs:/app/certs:ro|' docker-compose.yml
        PANEL_URL="https://localhost:8000"
        PANEL_PUBLIC_URL="https://${domain}"
        info "Certificate obtained — the panel will serve HTTPS directly on port 8000."
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
  info "  Panel:      $PANEL_PUBLIC_URL"
else
  info "  Panel API:  http://${HOST_IP}:8000"
fi
info "  Dashboard:  http://${HOST_IP}:8080"

TOKEN=""
read -r -p "Create the admin account right now, from this terminal? [Y/n] " make_admin
make_admin=${make_admin:-Y}
if [[ "$make_admin" =~ ^[Yy]$ ]]; then
  KEY_OUTPUT=$(docker exec tifusi-panel tifusi-cli generate-admin-key)
  SETUP_KEY=$(printf '%s\n' "$KEY_OUTPUT" | grep -Ev '^(Setup|Paste|$)' | tail -n1 | tr -d '[:space:]')

  read -r -p "Admin username: " admin_user
  read -r -s -p "Admin password (min 8 characters): " admin_pass
  echo

  RESPONSE=$(curl -fsSk -X POST "$PANEL_URL/api/setup/create-admin" \
    -H "Content-Type: application/json" \
    -d @- <<JSON
{"key": "$(json_escape "$SETUP_KEY")", "username": "$(json_escape "$admin_user")", "password": "$(json_escape "$admin_pass")"}
JSON
  ) || fail "Creating the admin account failed — try it from the browser instead."
  unset admin_pass

  TOKEN=$(json_field "$RESPONSE" access_token)
  [ -n "$TOKEN" ] || fail "Unexpected response from the panel: $RESPONSE"
  info "Admin account created."
else
  info "OK — later, from the browser: docker exec -it tifusi-panel tifusi-cli generate-admin-key"
fi

if [ -n "$TOKEN" ]; then
  warn "Running a node on the same server as the panel usually isn't recommended — keep panel and nodes separate when you can. But the installer offers it anyway, since it's a fine way to get started quickly."
  read -r -p "Install a node on this same server too? [y/N] " make_node
  make_node=${make_node:-N}
  if [[ "$make_node" =~ ^[Yy]$ ]]; then
    read -r -p "Node name [Local Node]: " node_name
    node_name=${node_name:-"Local Node"}
    read -r -p "Node port [62050]: " node_port
    node_port=${node_port:-62050}

    NODE_RESPONSE=$(curl -fsSk -X POST "$PANEL_URL/api/nodes" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d @- <<JSON
{"name": "$(json_escape "$node_name")", "address": "127.0.0.1", "port": $node_port}
JSON
    ) || fail "Creating the node failed."
    NODE_ID=$(json_field "$NODE_RESPONSE" id)
    NODE_KEY=$(json_field "$NODE_RESPONSE" api_key)
    [ -n "$NODE_ID" ] && [ -n "$NODE_KEY" ] || fail "Unexpected response from the panel: $NODE_RESPONSE"

    info "Building the node image..."
    BUILD_LOG="$(mktemp)"
    if ! docker build -t tifusi-node-agent -f backend/node_agent/Dockerfile backend > "$BUILD_LOG" 2>&1; then
      warn "Node image build failed — full output:"
      cat "$BUILD_LOG"
      rm -f "$BUILD_LOG"
      exit 1
    fi
    rm -f "$BUILD_LOG"

    if docker ps -a --format '{{.Names}}' | grep -qx tifusi-node; then
      docker rm -f tifusi-node >/dev/null
    fi
    info "Starting the node..."
    docker run -d --name tifusi-node --restart unless-stopped \
      -p "${node_port}:62050" -e "TIFUSI_NODE_API_KEY=${NODE_KEY}" tifusi-node-agent

    info "Running the initial sync..."
    sleep 2
    curl -fsSk -X POST "$PANEL_URL/api/nodes/${NODE_ID}/sync" -H "Authorization: Bearer $TOKEN" >/dev/null \
      || warn "The initial sync failed — trigger it manually from the panel's Nodes tab."

    info "Node created and running. Check its status from the panel's Nodes tab."
  fi
fi

info "Done."
