#!/usr/bin/env bash
# Tifusi Panel management CLI — installed as `tifusi` on PATH by install.sh.
# Run it any time (from anywhere) to update, reconfigure, or inspect an
# existing install; it's not the installer itself (see install.sh for that).
#
# Finds the panel by reading the install dir install.sh recorded at
# /etc/tifusi-panel/install_dir, falling back to TIFUSI_INSTALL_DIR or the
# same /opt/tifusi-panel default install.sh uses — so this works whether
# a caller sourced it from a custom install location or the ordinary one.

set -euo pipefail

STATE_FILE="/etc/tifusi-panel/install_dir"
if [ -f "$STATE_FILE" ]; then
  INSTALL_DIR="$(cat "$STATE_FILE")"
else
  INSTALL_DIR="${TIFUSI_INSTALL_DIR:-/opt/tifusi-panel}"
fi

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[1;31m'; C_GREEN=$'\033[1;32m'; C_YELLOW=$'\033[1;33m'
  C_CYAN=$'\033[1;36m'; C_GRAY=$'\033[0;90m'; C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""; C_GRAY=""; C_RESET=""; C_BOLD=""
fi

info() { printf '%s[Tifusi]%s %s\n' "$C_CYAN" "$C_RESET" "$1"; }
warn() { printf '%s[Warning]%s %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
err()  { printf '%s[Error]%s %s\n' "$C_RED" "$C_RESET" "$1"; }

if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
  err "No Tifusi Panel install found at $INSTALL_DIR (docker-compose.yml missing)."
  err "Set TIFUSI_INSTALL_DIR if it's installed somewhere else, or run install.sh first."
  exit 1
fi
cd "$INSTALL_DIR"

VERSION="$(cat backend/VERSION 2>/dev/null || echo '?')"

banner() {
  printf '\n%s _______ _____ ______ _    _  _____ _____\n' "$C_RED"
  printf '|__   __|_   _|  ____| |  | |/ ____|_   _|\n'
  printf '   | |    | | | |__  | |  | | (___   | |\n'
  printf '   | |    | | |  __| | |  | |\\___ \\  | |\n'
  printf '   | |   _| |_| |    | |__| |____) |_| |_\n'
  printf '   |_|  |_____|_|     \\____/|_____/|_____|%s\n\n' "$C_RESET"
  printf '%s%s  Tifusi Panel  %s %sv%s%s\n' "$C_BOLD" "$C_RED" "$C_RESET" "$C_YELLOW" "$VERSION" "$C_RESET"
  printf '%s  GitHub: https://github.com/javadtifusi-eng/Tifusi-Panel%s\n' "$C_GRAY" "$C_RESET"
}

port_in_use() {
  (command -v ss >/dev/null 2>&1 && ss -tlnH "( sport = :$1 )" 2>/dev/null | grep -q .) \
    || (command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1)
}
next_free_port() {
  local p="$1"
  while port_in_use "$p"; do p=$((p + 1)); done
  echo "$p"
}

action_update() {
  info "Checking for local changes..."
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    warn "This install has local changes (git status isn't clean) — not overwriting them."
    warn "Resolve or commit them yourself, then run this again. Skipping update."
    return
  fi
  info "Pulling latest code..."
  git pull --ff-only
  info "Pulling prebuilt images..."
  if ! docker compose pull; then
    warn "Prebuilt images unavailable — building locally instead (can take a few minutes on a small server)."
    docker compose build
  fi
  info "Restarting with the new version..."
  docker compose up -d
  info "Updated to $(cat backend/VERSION 2>/dev/null || echo '?')."
}

action_change_port() {
  local cur_panel cur_dash panel_port dashboard_port
  cur_panel=$(grep '^TIFUSI_PANEL_PORT=' .env 2>/dev/null | cut -d= -f2 || true)
  cur_dash=$(grep '^TIFUSI_DASHBOARD_PORT=' .env 2>/dev/null | cut -d= -f2 || true)
  info "Current ports — panel API: ${cur_panel:-8000}, dashboard: ${cur_dash:-8080}"

  read -r -p "New panel API port (Enter to keep ${cur_panel:-8000}): " panel_port
  panel_port=${panel_port:-$cur_panel}
  panel_port=${panel_port:-8000}
  if port_in_use "$panel_port" && [ "$panel_port" != "$cur_panel" ]; then
    err "Port $panel_port is already in use."; return
  fi

  read -r -p "New dashboard port (Enter to keep ${cur_dash:-8080}): " dashboard_port
  dashboard_port=${dashboard_port:-$cur_dash}
  dashboard_port=${dashboard_port:-8080}
  if port_in_use "$dashboard_port" && [ "$dashboard_port" != "$cur_dash" ]; then
    err "Port $dashboard_port is already in use."; return
  fi

  awk -v p="$panel_port" -v d="$dashboard_port" '
    /^TIFUSI_PANEL_PORT=/ { print "TIFUSI_PANEL_PORT=" p; next }
    /^TIFUSI_DASHBOARD_PORT=/ { print "TIFUSI_DASHBOARD_PORT=" d; next }
    { print }
  ' .env > .env.tmp
  grep -q '^TIFUSI_PANEL_PORT=' .env.tmp || echo "TIFUSI_PANEL_PORT=$panel_port" >> .env.tmp
  grep -q '^TIFUSI_DASHBOARD_PORT=' .env.tmp || echo "TIFUSI_DASHBOARD_PORT=$dashboard_port" >> .env.tmp
  mv .env.tmp .env

  info "Applying (recreating containers)..."
  docker compose up -d
  info "Panel API now on $panel_port, dashboard on $dashboard_port."
}

action_get_ssl() {
  read -r -p "Domain (must already resolve to this server's IP): " domain
  [ -n "$domain" ] || { err "No domain entered."; return; }
  info "Requesting a Let's Encrypt certificate for $domain (needs port 80 free)..."
  mkdir -p certs letsencrypt-work
  CERT_LOG="$(mktemp)"
  if docker run --rm -p 80:80 -v "$(pwd)/letsencrypt-work:/etc/letsencrypt" \
    certbot/certbot certonly --standalone --non-interactive --agree-tos \
    -m "admin@${domain}" -d "$domain" > "$CERT_LOG" 2>&1; then
    cat "$CERT_LOG"
    cp "letsencrypt-work/live/${domain}/fullchain.pem" certs/fullchain.pem
    cp "letsencrypt-work/live/${domain}/privkey.pem" certs/privkey.pem
    if grep -q '^TIFUSI_PUBLIC_URL=' .env; then
      sed -i "s#^TIFUSI_PUBLIC_URL=.*#TIFUSI_PUBLIC_URL=https://${domain}#" .env
    else
      echo "TIFUSI_PUBLIC_URL=https://${domain}" >> .env
    fi
    docker compose up -d
    info "Certificate installed — the dashboard now serves HTTPS on https://${domain}."
    warn "Let's Encrypt certs expire every 90 days — re-run this before then, or set up certbot renew yourself."
  else
    err "Certificate request failed — full output:"
    cat "$CERT_LOG"
  fi
  rm -f "$CERT_LOG"
}

action_admin_key() {
  docker exec -it tifusi-panel tifusi-cli generate-admin-key
}

action_restart() {
  info "Restarting panel and dashboard..."
  docker compose restart panel dashboard
  info "Restarted."
}

action_logs() {
  info "Showing live logs (Ctrl+C to return to the menu)..."
  docker compose logs -f --tail=100 panel dashboard || true
}

action_backup() {
  local out="tifusi-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
  info "Backing up data/, certs/, and .env to $out..."
  tar czf "$out" data certs .env 2>/dev/null || tar czf "$out" data .env
  info "Saved: $(pwd)/$out"
}

action_restore() {
  read -r -p "Path to backup .tar.gz: " backup_path
  [ -f "$backup_path" ] || { err "File not found: $backup_path"; return; }
  warn "This overwrites the current data/, certs/, and .env. Existing users/hosts/nodes will be replaced."
  read -r -p "Type YES to continue: " confirm
  [ "$confirm" = "YES" ] || { info "Cancelled."; return; }
  docker compose down
  tar xzf "$backup_path"
  docker compose up -d
  info "Restored from $backup_path and restarted."
}

action_status() {
  docker compose ps
  echo
  local panel_port dashboard_port
  panel_port=$(grep '^TIFUSI_PANEL_PORT=' .env 2>/dev/null | cut -d= -f2 || true)
  panel_port=${panel_port:-8000}
  if curl -fsSk "http://localhost:${panel_port}/api/setup/status" >/dev/null 2>&1; then
    printf '%sPanel API:%s reachable on port %s\n' "$C_GREEN" "$C_RESET" "$panel_port"
  else
    printf '%sPanel API:%s not responding on port %s\n' "$C_RED" "$C_RESET" "$panel_port"
  fi
}

action_uninstall() {
  warn "This stops every Tifusi container, deletes all panel data (users, hosts, nodes, certs), and removes this 'tifusi' command."
  read -r -p "Type the word DELETE to continue: " confirm
  [ "$confirm" = "DELETE" ] || { info "Cancelled."; return; }
  docker compose down -v
  read -r -p "Also delete the install directory ($INSTALL_DIR)? [y/N] " del_dir
  cd /
  if [[ "${del_dir:-N}" =~ ^[Yy]$ ]]; then
    rm -rf "$INSTALL_DIR"
    info "Removed $INSTALL_DIR."
  fi
  rm -f "$STATE_FILE" /usr/local/bin/tifusi
  info "Tifusi Panel uninstalled."
  exit 0
}

menu() {
  banner
  printf '\n%s  What would you like to do?%s\n\n' "$C_CYAN" "$C_RESET"
  printf '  %s 1)%s Update panel to the latest version\n' "$C_GREEN" "$C_RESET"
  printf '  %s 2)%s Change panel / dashboard port\n' "$C_GREEN" "$C_RESET"
  printf "  %s 3)%s Get a free SSL certificate (Let's Encrypt)\n" "$C_GREEN" "$C_RESET"
  printf '  %s 4)%s Show / generate one-time admin setup key\n' "$C_GREEN" "$C_RESET"
  printf '  %s 5)%s Restart panel and dashboard\n' "$C_GREEN" "$C_RESET"
  printf '  %s 6)%s View live logs\n' "$C_GREEN" "$C_RESET"
  printf '  %s 7)%s Backup panel\n' "$C_GREEN" "$C_RESET"
  printf '  %s 8)%s Restore from backup\n' "$C_GREEN" "$C_RESET"
  printf '  %s 9)%s Show service status\n' "$C_GREEN" "$C_RESET"
  printf '  %s10)%s Uninstall panel completely\n' "$C_GREEN" "$C_RESET"
  printf '  %s 0)%s Exit\n\n' "$C_GRAY" "$C_RESET"
  read -r -p "$(printf '%sEnter your choice: %s' "$C_GREEN" "$C_RESET")" choice
  echo
  case "$choice" in
    1) action_update ;;
    2) action_change_port ;;
    3) action_get_ssl ;;
    4) action_admin_key ;;
    5) action_restart ;;
    6) action_logs ;;
    7) action_backup ;;
    8) action_restore ;;
    9) action_status ;;
    10) action_uninstall ;;
    0) exit 0 ;;
    *) warn "Invalid choice." ;;
  esac
}

# A single argument runs one action non-interactively (`tifusi update`,
# `tifusi status`, ...) for scripting/cron; no args drops into the menu loop.
case "${1:-}" in
  update) action_update ;;
  port) action_change_port ;;
  ssl) action_get_ssl ;;
  key) action_admin_key ;;
  restart) action_restart ;;
  logs) action_logs ;;
  backup) action_backup ;;
  restore) action_restore ;;
  status) action_status ;;
  uninstall) action_uninstall ;;
  "")
    while true; do
      menu
      echo
      read -r -p "Press Enter to return to the menu..." _
      clear 2>/dev/null || true
    done
    ;;
  *)
    err "Unknown command: $1"
    err "Run 'tifusi' with no arguments for the interactive menu."
    exit 1
    ;;
esac
