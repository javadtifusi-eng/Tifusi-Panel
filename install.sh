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
# Set for real in the "Ports" step below, once the chosen panel port is known.
PANEL_URL=""

# Only emit color/box-drawing escapes into a real, color-capable terminal —
# piped into a log file or a dumb terminal, raw escape codes are exactly
# the "garbled unclear lines" this is here to avoid.
IS_TTY=""
[ -t 1 ] && [ -z "${NO_COLOR:-}" ] && IS_TTY=1

if [ -n "$IS_TTY" ]; then
  C_CYAN=$'\033[1;36m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[1;31m'; C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'; C_MAGENTA=$'\033[1;35m'; C_GREEN=$'\033[1;32m'
else
  C_CYAN=""; C_YELLOW=""; C_RED=""; C_RESET=""; C_BOLD=""; C_MAGENTA=""; C_GREEN=""
fi

info() { printf '%s[Tifusi]%s %s\n' "$C_CYAN" "$C_RESET" "$1"; }
warn() { printf '%s[Warning]%s %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
fail() { printf '%s[Error]%s %s\n' "$C_RED" "$C_RESET" "$1"; exit 1; }

# Runs a command in the background with a spinner in front of its message —
# apt-get update, the Docker install script, and image pulls/builds can sit
# with zero output for a minute or more otherwise, which reads as a hang
# rather than progress (the gap this closes; every other panel's installer
# animates something here). Falls back to a plain "before/after" line when
# stdout isn't a real terminal, same rule as the color escapes above.
_SPINNER_FRAMES='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
run_spinner() {
  local msg="$1"; shift
  local log; log="$(mktemp)"
  "$@" >"$log" 2>&1 &
  local pid=$!
  if [ -n "$IS_TTY" ]; then
    local i=0 frame_count=${#_SPINNER_FRAMES}
    while kill -0 "$pid" 2>/dev/null; do
      printf '\r%s%s%s %s' "$C_CYAN" "${_SPINNER_FRAMES:$((i % frame_count)):1}" "$C_RESET" "$msg"
      i=$((i + 1))
      sleep 0.1
    done
  else
    printf '%s ...\n' "$msg"
  fi
  local status=0
  wait "$pid" || status=$?
  if [ "$status" -eq 0 ]; then
    printf '\r%s✔%s %s%s\n' "$C_GREEN" "$C_RESET" "$msg" "$([ -n "$IS_TTY" ] && printf '%*s' 10 '' || true)"
  else
    printf '\r%s✘%s %s\n' "$C_RED" "$C_RESET" "$msg"
    cat "$log"
  fi
  rm -f "$log"
  return "$status"
}

# Renders `lines` inside a box-drawing rectangle wide enough for its widest
# line, titled and colored — used for the SSL summary below so the cert
# paths/fingerprint/content read as one clear block instead of scattered
# log lines the way certbot's own raw output does.
_repeat_char() { printf '%*s' "$1" '' | tr ' ' "$2"; }
print_box() {
  local title="$1" color="$2"; shift 2
  local -a lines=("$@")
  local w=0 l
  for l in "${lines[@]}"; do (( ${#l} > w )) && w=${#l}; done
  local title_w=$(( ${#title} + 2 ))
  (( title_w > w )) && w=$title_w
  printf '\n%s┌─ %s ' "$color" "$title"
  printf '%s' "$(_repeat_char $((w - ${#title} - 1)) '─')"
  printf '┐%s\n' "$C_RESET"
  for l in "${lines[@]}"; do
    printf '%s│%s %-*s %s│%s\n' "$color" "$C_RESET" "$w" "$l" "$color" "$C_RESET"
  done
  printf '%s└%s┘%s\n' "$color" "$(_repeat_char $((w + 2)) '─')" "$C_RESET"
}

# Prints the paths, the full fullchain.pem content, and the panel access
# info once a certificate is in place. The private key's own content is
# deliberately NOT printed in full here — dumping a TLS private key to a
# terminal (and whatever logs that terminal feeds) is a real credential
# leak, so this shows its path and public-key fingerprint instead, the way
# `ssh-keygen -l` does for SSH keys, and points at `cat` for anyone who
# genuinely needs the raw key on-screen.
show_ssl_summary() {
  local fullchain="$1" privkey="$2" public_url="$3" dash_port="$4"
  local -a cert_lines privkey_info
  mapfile -t cert_lines < "$fullchain"

  local key_fp
  key_fp=$(openssl pkey -in "$privkey" -pubout -outform DER 2>/dev/null \
    | openssl sha256 -r 2>/dev/null | awk '{print $1}' \
    | sed 's/../&:/g; s/:$//' | tr '[:lower:]' '[:upper:]')

  privkey_info=(
    "Path         :  $privkey"
    "SHA256 (pub) :  ${key_fp:-unavailable}"
    ""
    "Kept out of this box on purpose — it's the private half of your TLS"
    "key. Read it on the server directly if you ever need the raw text:"
    "  cat $privkey"
  )

  printf '\n%s%s✔ SSL Certificate Installed%s\n' "$C_GREEN" "$C_BOLD" "$C_RESET"
  printf '\n  %sFullchain%s :  %s%s%s\n' "$C_BOLD" "$C_RESET" "$C_GREEN" "$fullchain" "$C_RESET"
  printf '  %sPrivkey  %s :  %s%s%s\n' "$C_BOLD" "$C_RESET" "$C_GREEN" "$privkey" "$C_RESET"

  print_box "Fullchain.pem" "$C_CYAN" "${cert_lines[@]}"
  print_box "Privkey.pem (info only, not the raw key)" "$C_YELLOW" "${privkey_info[@]}"
  print_box "Panel Access Info" "$C_MAGENTA" "Dashboard :  $public_url" "Port      :  $dash_port"
}

# One line per install phase (system deps, docker, repo, .env, SSL, build,
# health check) — a percentage instead of a bare step count so a long build
# still reads as visible progress rather than a silent hang.
STEP_TOTAL=9
STEP_NUM=0
step() {
  STEP_NUM=$((STEP_NUM + 1))
  printf '%s[%d/%d · %d%%]%s %s\n' "$C_CYAN" "$STEP_NUM" "$STEP_TOTAL" $((STEP_NUM * 100 / STEP_TOTAL)) "$C_RESET" "$1"
}

# Same big block-letter "TIFUSI" (figlet -f big) as backend/cli/main.py's
# generate-admin-key banner, so the two feel like one product — but in
# magenta instead of that command's cyan, so it's clear at a glance which
# stage (install vs. admin-key) produced the banner on screen.
_BIG_TIFUSI='
 _______ _____ ______ _    _  _____ _____
|__   __|_   _|  ____| |  | |/ ____|_   _|
   | |    | | | |__  | |  | | (___   | |
   | |    | | |  __| | |  | |\___ \  | |
   | |   _| |_| |    | |__| |____) |_| |_
   |_|  |_____|_|     \____/|_____/|_____|
'

banner() {
  printf '\n%s%s%s\n' "$C_MAGENTA$C_BOLD" "$_BIG_TIFUSI" "$C_RESET"
  printf '%s  Tifusi Panel installer%s\n\n' "$C_MAGENTA" "$C_RESET"
}

banner
info "Installing Tifusi Panel..."

step "System packages"
if command -v apt-get >/dev/null 2>&1; then
  run_spinner "Updating the system's package list (apt-get update)..." \
    env DEBIAN_FRONTEND=noninteractive apt-get update -y \
    || warn "apt-get update failed — continuing anyway."
fi

step "Docker"
if ! command -v docker >/dev/null 2>&1; then
  run_spinner "Docker isn't installed — installing it with the official script..." \
    bash -c 'curl -fsSL https://get.docker.com | sh' || true
  command -v docker >/dev/null 2>&1 \
    || fail "Automatic Docker install failed — try it manually: curl -fsSL https://get.docker.com | sh"
fi
docker compose version >/dev/null 2>&1 \
  || fail "Docker is installed but the docker compose plugin isn't (or is too old) — update Docker."

step "Repository"
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

step "Configuration (.env)"
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  awk -v s="$SECRET" '{gsub(/^TIFUSI_SECRET_KEY=.*/, "TIFUSI_SECRET_KEY=" s)}1' .env > .env.tmp
  mv .env.tmp .env
  info "Generated a random TIFUSI_SECRET_KEY in .env."
fi

step "Ports"
# A port already in use on this server would make the container fail to
# start later with a confusing Docker error — check now instead, and if
# the caller just hits Enter (wants the default), pick the next free port
# starting from it rather than blindly handing back something taken.
port_in_use() {
  (command -v ss >/dev/null 2>&1 && ss -tlnH "( sport = :$1 )" 2>/dev/null | grep -q .) \
    || (command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1)
}
next_free_port() {
  local p="$1"
  while port_in_use "$p"; do p=$((p + 1)); done
  echo "$p"
}

read -r -p "Panel API port (Enter to auto-pick, starting from 8000): " panel_port
if [ -z "$panel_port" ]; then
  panel_port=$(next_free_port 8000)
  info "Auto-picked port $panel_port for the panel API."
elif port_in_use "$panel_port"; then
  warn "Port $panel_port is already in use on this server — pick a different one."
  read -r -p "Panel API port: " panel_port
fi

read -r -p "Dashboard (web UI) port (Enter to auto-pick, starting from 8080): " dashboard_port
if [ -z "$dashboard_port" ]; then
  dashboard_port=$(next_free_port 8080)
  info "Auto-picked port $dashboard_port for the dashboard."
elif port_in_use "$dashboard_port"; then
  warn "Port $dashboard_port is already in use on this server — pick a different one."
  read -r -p "Dashboard port: " dashboard_port
fi
awk -v p="$panel_port" -v d="$dashboard_port" '
  /^TIFUSI_PANEL_PORT=/ { print "TIFUSI_PANEL_PORT=" p; next }
  /^# TIFUSI_PANEL_PORT=/ { print "TIFUSI_PANEL_PORT=" p; next }
  /^TIFUSI_DASHBOARD_PORT=/ { print "TIFUSI_DASHBOARD_PORT=" d; next }
  /^# TIFUSI_DASHBOARD_PORT=/ { print "TIFUSI_DASHBOARD_PORT=" d; next }
  { print }
' .env > .env.tmp
grep -q '^TIFUSI_PANEL_PORT=' .env.tmp || echo "TIFUSI_PANEL_PORT=$panel_port" >> .env.tmp
grep -q '^TIFUSI_DASHBOARD_PORT=' .env.tmp || echo "TIFUSI_DASHBOARD_PORT=$dashboard_port" >> .env.tmp
mv .env.tmp .env
PANEL_URL="http://localhost:${panel_port}"
info "Panel API on port $panel_port, dashboard on port $dashboard_port."

step "SSL / domain"
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
        # Certbot's own "Congratulations" box already states exactly where
        # the cert and key ended up — show it instead of just our one-line
        # paraphrase of it, the way every other panel's installer does.
        cat "$CERT_LOG"
        cp "letsencrypt-work/live/${domain}/fullchain.pem" certs/fullchain.pem
        cp "letsencrypt-work/live/${domain}/privkey.pem" certs/privkey.pem
        echo "TIFUSI_PUBLIC_URL=https://${domain}" >> .env
        PANEL_PUBLIC_URL="https://${domain}"
        show_ssl_summary "$(pwd)/certs/fullchain.pem" "$(pwd)/certs/privkey.pem" "$PANEL_PUBLIC_URL" "$dashboard_port"
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

step "Building & starting containers"
if run_spinner "Trying prebuilt images first (faster than building locally)..." docker compose pull; then
  BUILD_CMD=(docker compose up -d)
else
  info "Prebuilt images aren't available (offline registry, or this repo's Packages aren't Public yet) — building locally instead. This can take a few minutes."
  BUILD_CMD=(docker compose up -d --build)
fi
run_spinner "Building & starting containers..." "${BUILD_CMD[@]}" || exit 1

step "Management command"
mkdir -p /etc/tifusi-panel
echo "$INSTALL_DIR" > /etc/tifusi-panel/install_dir
cp manage.sh /usr/local/bin/tifusi
chmod +x /usr/local/bin/tifusi
info "Installed the 'tifusi' command — run it any time to update, change ports, get SSL, back up, or uninstall."

step "Health check"
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
  info "  SSL:        enabled (Let's Encrypt, ${domain:-})"
  info "  Certs:      ${INSTALL_DIR}/certs/fullchain.pem + privkey.pem"
  info "  Dashboard:  $PANEL_PUBLIC_URL"
else
  info "  Dashboard:  http://${HOST_IP}:${dashboard_port}"
fi
info "  Panel API:  http://${HOST_IP}:${panel_port}"
info ""
info "To create the admin account, open the dashboard in your browser, then run this to get a one-time setup key:"
info "  tifusi key"
info "Paste that key into the login page along with the username/password you want, and you're in."
info ""
info "Run 'tifusi' any time (updates, ports, SSL, backups, uninstall) — or just 'tifusi' with no arguments for a menu."
info "Done."
