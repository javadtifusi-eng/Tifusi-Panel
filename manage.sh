#!/usr/bin/env bash
# Tifusi Panel management CLI — installed as `tifusi-panel` by install.sh and run as `tifusi panel`.
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
# See install.sh: docker-compose.yml already publishes 80 and 443, so handing
# either to TIFUSI_PANEL_PORT/TIFUSI_DASHBOARD_PORT double-binds one host port
# and the container stops starting at all.
port_reserved() { [ "$1" = 80 ]; }
# See install.sh: a free high port, so installs don't all sit on the same
# well-known defaults. $RANDOM tops out at 32767, hence the pair of draws.
random_free_port() {
  local p
  while true; do
    p=$(( (RANDOM * 32768 + RANDOM) % 45001 + 20000 ))
    port_reserved "$p" && continue
    port_in_use "$p" || { echo "$p"; return; }
  done
}

# The professional edition (install.sh --pro) keeps its data in the bundled MySQL.
is_pro() { grep -q '^TIFUSI_EDITION=pro' .env 2>/dev/null; }

action_update() {
  info "Checking for local changes..."
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    warn "This install has local changes (git status isn't clean) — not overwriting them."
    warn "Resolve or commit them yourself, then run this again. Skipping update."
    return
  fi
  info "Pulling latest code..."
  git pull --ff-only
  # A pull alone leaves tifusi-panel and the shared launcher at the previously installed version.
  source scripts/install-commands.sh
  install_panel_commands
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
  local cur_panel cur_dash cur_https panel_port dashboard_port https_port
  cur_panel=$(grep '^TIFUSI_PANEL_PORT=' .env 2>/dev/null | cut -d= -f2 || true)
  cur_dash=$(grep '^TIFUSI_DASHBOARD_PORT=' .env 2>/dev/null | cut -d= -f2 || true)
  cur_https=$(grep '^TIFUSI_DASHBOARD_HTTPS_PORT=' .env 2>/dev/null | cut -d= -f2 || true)
  cur_panel=${cur_panel:-8000}; cur_dash=${cur_dash:-8080}; cur_https=${cur_https:-443}
  info "Current ports — panel API: $cur_panel, dashboard HTTP: $cur_dash, dashboard HTTPS: $cur_https"

  # Rejects a reserved port, one already listening (unless this install is
  # what's listening on it), or one this same run already spent.
  local -a picked=()
  check_port() {
    local value=$1 current=$2
    if ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt 1 ] || [ "$value" -gt 65535 ]; then
      err "'$value' isn't a valid port number."; return 1
    fi
    if port_reserved "$value"; then
      err "Port $value is reserved — the panel answers Let's Encrypt on it."; return 1
    fi
    local p
    for p in ${picked[@]+"${picked[@]}"}; do
      [ "$p" = "$value" ] && { err "Port $value is already going to another Tifusi service."; return 1; }
    done
    if [ "$value" != "$current" ] && port_in_use "$value"; then
      err "Port $value is already in use."; return 1
    fi
    picked+=("$value")
  }

  # 'r' here means the same thing it does in install.sh's prompts.
  resolve_port() {
    local value=$1 current=$2
    case "$value" in
      "") echo "$current" ;;
      r|R) random_free_port ;;
      *) echo "$value" ;;
    esac
  }

  read -r -p "New panel API port (Enter to keep $cur_panel, 'r' for a random one): " panel_port
  panel_port=$(resolve_port "$panel_port" "$cur_panel")
  check_port "$panel_port" "$cur_panel" || return

  read -r -p "New dashboard HTTP port (Enter to keep $cur_dash, 'r' for a random one): " dashboard_port
  dashboard_port=$(resolve_port "$dashboard_port" "$cur_dash")
  check_port "$dashboard_port" "$cur_dash" || return

  # Behind Cloudflare's proxy an origin is only reachable on 443, 2053, 2083,
  # 2087, 2096 or 8443, so this has to be changeable after install too.
  read -r -p "New dashboard HTTPS port (Enter to keep $cur_https, 'r' for a random one): " https_port
  https_port=$(resolve_port "$https_port" "$cur_https")
  check_port "$https_port" "$cur_https" || return

  # Moving the HTTPS port moves the URL clients fetch their subscription from,
  # so carry TIFUSI_PUBLIC_URL along instead of leaving it pointing at the old
  # port — "https://host" only ever implies 443.
  local public_url new_public_url=""
  public_url=$(grep '^TIFUSI_PUBLIC_URL=' .env 2>/dev/null | cut -d= -f2- || true)
  if [ -n "$public_url" ] && [ "$https_port" != "$cur_https" ]; then
    local host=${public_url#https://}; host=${host#http://}; host=${host%%/*}; host=${host%%:*}
    if [ "$https_port" = 443 ]; then
      new_public_url="https://${host}"
    else
      new_public_url="https://${host}:${https_port}"
    fi
  fi

  awk -v p="$panel_port" -v d="$dashboard_port" -v s="$https_port" -v u="$new_public_url" '
    /^TIFUSI_PANEL_PORT=/ { print "TIFUSI_PANEL_PORT=" p; next }
    /^TIFUSI_DASHBOARD_PORT=/ { print "TIFUSI_DASHBOARD_PORT=" d; next }
    /^TIFUSI_DASHBOARD_HTTPS_PORT=/ { print "TIFUSI_DASHBOARD_HTTPS_PORT=" s; next }
    /^TIFUSI_PUBLIC_URL=/ { if (u != "") print "TIFUSI_PUBLIC_URL=" u; else print; next }
    { print }
  ' .env > .env.tmp
  grep -q '^TIFUSI_PANEL_PORT=' .env.tmp || echo "TIFUSI_PANEL_PORT=$panel_port" >> .env.tmp
  grep -q '^TIFUSI_DASHBOARD_PORT=' .env.tmp || echo "TIFUSI_DASHBOARD_PORT=$dashboard_port" >> .env.tmp
  grep -q '^TIFUSI_DASHBOARD_HTTPS_PORT=' .env.tmp || echo "TIFUSI_DASHBOARD_HTTPS_PORT=$https_port" >> .env.tmp
  mv .env.tmp .env

  info "Applying (recreating containers)..."
  docker compose up -d
  info "Panel API now on $panel_port, dashboard on $dashboard_port (HTTP) and $https_port (HTTPS)."

  # .env alone isn't enough: the panel builds every subscription link from the
  # URL in its own database, and TIFUSI_PUBLIC_URL only seeds that row on the
  # very first run (backend/app/settings_store.py). Without this, moving the
  # HTTPS port leaves every link and access code naming the old port, and the
  # admin has no way to tell from the installer that anything is wrong.
  if [ "$https_port" != "$cur_https" ]; then
    local stored="" tries
    for tries in $(seq 1 15); do
      stored=$(docker exec tifusi-panel tifusi-cli show-public-url 2>/dev/null | tr -d '\r' | tail -n 1) && [ -n "$stored" ] && break
      sleep 2
    done
    if [ -n "$stored" ]; then
      local host=${stored#https://}; host=${host#http://}; host=${host%%/*}; host=${host%%:*}
      local updated="https://${host}"
      [ "$https_port" = 443 ] || updated="https://${host}:${https_port}"
      if docker exec tifusi-panel tifusi-cli set-public-url "$updated" >/dev/null 2>&1; then
        new_public_url="$updated"
      else
        warn "Couldn't update the panel's saved address — set it to $updated under Settings, or subscription links keep the old port."
      fi
    fi
  fi
  [ -n "$new_public_url" ] && info "Public URL updated to $new_public_url."
  if [ "$https_port" != 443 ]; then
    warn "Let's Encrypt validates over port 80, which is untouched — but browsers only reach this dashboard at :$https_port now."
  fi
  return 0
}

action_get_ssl() {
  read -r -p "Domain (must already resolve to this server's IP): " domain
  [ -n "$domain" ] || { err "No domain entered."; return; }
  info "Requesting a Let's Encrypt certificate for $domain (needs port 80 free)..."
  mkdir -p certs letsencrypt-work
  CERT_LOG="$(mktemp)"
  # --key-type rsa: see install.sh's own SSL step for why — a node's
  # strongSwan can't parse an ECDSA cert if this one later gets reused as
  # an IKEv2 Core's certificate.
  if docker run --rm -p 80:80 -v "$(pwd)/letsencrypt-work:/etc/letsencrypt" \
    certbot/certbot certonly --standalone --non-interactive --agree-tos \
    --key-type rsa --rsa-key-size 2048 \
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

action_remove_node() {
  local nodes
  nodes=$(docker exec tifusi-panel tifusi-cli list-nodes 2>/dev/null | grep -E '^[0-9]+	') || true
  if [ -z "$nodes" ]; then
    info "This panel has no nodes registered."
    return
  fi

  printf '\n%s  Nodes registered with this panel:%s\n\n' "$C_CYAN" "$C_RESET"
  printf '%s\n' "$nodes" | while IFS=$'\t' read -r id name address status; do
    printf '  %s%3s)%s %-24s %-24s %s\n' "$C_GREEN" "$id" "$C_RESET" "$name" "$address" "$status"
  done
  echo

  local node_id
  read -r -p "Node id to remove (Enter to cancel): " node_id
  [ -n "$node_id" ] || { info "Cancelled."; return; }
  if ! printf '%s\n' "$nodes" | cut -f1 | grep -qx "$node_id"; then
    err "No node with id $node_id in the list above."; return
  fi

  warn "This removes the node from the panel. The agent on that server keeps running."
  local confirm
  read -r -p "Remove node $node_id? [y/N] " confirm
  [[ "${confirm:-N}" =~ ^[Yy]$ ]] || { info "Cancelled."; return; }

  docker exec tifusi-panel tifusi-cli remove-node "$node_id" || return

  # Only offer this where the agent is actually reachable as a local
  # container — a node on another server has its own `tifusi node uninstall`.
  if docker ps -a --format '{{.Names}}' | grep -qx tifusi-node; then
    read -r -p "The node agent container is on this server too — remove it as well? [y/N] " confirm
    if [[ "${confirm:-N}" =~ ^[Yy]$ ]]; then
      docker rm -f tifusi-node >/dev/null && info "Removed the tifusi-node container."
    fi
  else
    info "To remove the agent itself, run 'tifusi node uninstall' on that server."
  fi
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
  if is_pro; then
    info "Dumping the MySQL database..."
    mkdir -p data
    # A consistent snapshot without locking the panel out while it runs.
    if ! docker compose exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers tifusi' > data/mysql-dump.sql; then
      err "mysqldump failed — is the tifusi-mysql container running? Check with: tifusi panel status"
      rm -f data/mysql-dump.sql
      return
    fi
  fi
  info "Backing up data/, certs/, and .env to $out..."
  tar czf "$out" data certs .env 2>/dev/null || tar czf "$out" data .env
  if is_pro; then rm -f data/mysql-dump.sql; fi
  info "Saved: $(pwd)/$out"
}

action_restore() {
  read -r -p "Path to backup .tar.gz: " backup_path
  [ -f "$backup_path" ] || { err "File not found: $backup_path"; return; }
  warn "This overwrites the current data/, certs/, and .env. Existing users/hosts/nodes will be replaced."
  read -r -p "Type YES to continue: " confirm
  [ "$confirm" = "YES" ] || { info "Cancelled."; return; }
  # mysql-data/ is not part of the backup, so the MySQL server on this machine
  # keeps its own passwords — carry them over the ones in the restored .env.
  local keep_mysql=""
  if is_pro; then keep_mysql="$(grep -E '^(TIFUSI_MYSQL_PASSWORD|TIFUSI_MYSQL_ROOT_PASSWORD|TIFUSI_DATABASE_URL)=' .env)"; fi
  docker compose down
  tar xzf "$backup_path"
  if [ -n "$keep_mysql" ] && is_pro; then
    grep -vE '^(TIFUSI_MYSQL_PASSWORD|TIFUSI_MYSQL_ROOT_PASSWORD|TIFUSI_DATABASE_URL)=' .env > .env.restore-tmp
    printf '%s\n' "$keep_mysql" >> .env.restore-tmp
    mv .env.restore-tmp .env
    chmod 600 .env
  fi
  if is_pro && [ -f data/mysql-dump.sql ]; then
    info "Starting MySQL and importing the database dump..."
    docker compose up -d mysql
    for _ in $(seq 1 90); do
      docker compose exec -T mysql sh -c 'mysqladmin ping -uroot -p"$MYSQL_ROOT_PASSWORD" --silent' >/dev/null 2>&1 && break
      sleep 2
    done
    if ! docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" tifusi' < data/mysql-dump.sql; then
      err "Importing the MySQL dump failed — the dump is kept at $(pwd)/data/mysql-dump.sql."
      return
    fi
    rm -f data/mysql-dump.sql
  fi
  docker compose up -d
  info "Restored from $backup_path and restarted."
}

action_status() {
  if is_pro; then
    printf '%sEdition:%s professional (MySQL)\n' "$C_GREEN" "$C_RESET"
  else
    printf '%sEdition:%s standard (SQLite)\n' "$C_GREEN" "$C_RESET"
  fi
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
  warn "This stops every Tifusi container, deletes all panel data (users, hosts, nodes, certs), and removes the 'tifusi panel' command."
  read -r -p "Type the word DELETE to continue: " confirm
  [ "$confirm" = "DELETE" ] || { info "Cancelled."; return; }
  docker compose down -v
  # data/, certs/ and mysql-data/ are bind mounts, not named volumes, so
  # `down -v` leaves every one of them behind. Reinstalling then starts MySQL
  # on a datadir that still holds the *old* credentials while install.sh has
  # just written freshly generated ones into .env — MySQL ignores MYSQL_*
  # for an already-initialised datadir, so the panel could never authenticate.
  rm -rf "$INSTALL_DIR/data" "$INSTALL_DIR/certs" "$INSTALL_DIR/mysql-data" "$INSTALL_DIR/letsencrypt-work"
  read -r -p "Also delete the install directory ($INSTALL_DIR)? [y/N] " del_dir
  cd /
  if [[ "${del_dir:-N}" =~ ^[Yy]$ ]]; then
    rm -rf "$INSTALL_DIR"
    info "Removed $INSTALL_DIR."
  fi
  rm -f "$STATE_FILE" /usr/local/bin/tifusi-panel
  # The launcher is shared with Tifusi Bot, so it stays while the bot is installed.
  [ -e /usr/local/bin/tifusi-bot ] || rm -f /usr/local/bin/tifusi
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
  printf '  %s10)%s Remove a node from this panel\n' "$C_GREEN" "$C_RESET"
  printf '  %s11)%s Uninstall panel completely\n' "$C_GREEN" "$C_RESET"
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
    10) action_remove_node ;;
    11) action_uninstall ;;
    0) exit 0 ;;
    *) warn "Invalid choice." ;;
  esac
}

# A single argument runs one action non-interactively (`tifusi panel update`,
# `tifusi panel status`, ...) for scripting/cron; no args drops into the menu loop.
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
  remove-node) action_remove_node ;;
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
    err "Run 'tifusi panel' with no arguments for the interactive menu."
    exit 1
    ;;
esac
