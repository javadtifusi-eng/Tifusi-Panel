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

# See install.sh: one tool or the other, never both — BusyBox's lsof exits 0
# whatever it is asked, so asking it about a port ss already called free
# makes every port look taken.
port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -tlnH "( sport = :$1 )" 2>/dev/null | grep -q .
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}
next_free_port() {
  local p="$1"
  while [ "$p" -le 65535 ] && port_in_use "$p"; do p=$((p + 1)); done
  [ "$p" -le 65535 ] || { err "Couldn't find a free port at or above $1."; return 1; }
  echo "$p"
}
# See install.sh: docker-compose.yml already publishes 80 and 443, so handing
# either to TIFUSI_PANEL_PORT/TIFUSI_DASHBOARD_PORT double-binds one host port
# and the container stops starting at all.
port_reserved() { [ "$1" = 80 ]; }
# See install.sh: a free high port, so installs don't all sit on the same
# well-known defaults. $RANDOM tops out at 32767, hence the pair of draws.
random_free_port() {
  local p tries
  for tries in $(seq 1 200); do
    p=$(( (RANDOM * 32768 + RANDOM) % 45001 + 20000 ))
    port_reserved "$p" && continue
    port_in_use "$p" || { echo "$p"; return; }
  done
  err "Couldn't find a free random port after 200 tries."
  return 1
}

# The professional edition (install.sh --pro) keeps its data in the bundled MySQL.
is_pro() { grep -q '^TIFUSI_EDITION=pro' .env 2>/dev/null; }

# --- safe update: snapshot, then roll back if the panel doesn't come up ------

ROLLBACK_DIR="$INSTALL_DIR/.rollback"

# The host port the panel API is published on, for the health probe.
panel_api_port() {
  local p
  p=$(grep '^TIFUSI_PANEL_PORT=' .env 2>/dev/null | cut -d= -f2)
  echo "${p:-8000}"
}

# Healthy = the backend container is running (not restarting) and the API
# answers. /api/setup/status needs no auth and returns 200 once the app has
# started and its migrations have run.
panel_healthy() {
  local state port
  state=$(docker inspect -f '{{.State.Status}}' tifusi-panel 2>/dev/null || echo missing)
  [ "$state" = "running" ] || return 1
  port=$(panel_api_port)
  curl -fsS -m 5 -o /dev/null "http://127.0.0.1:${port}/api/setup/status" 2>/dev/null
}

wait_healthy() {
  local timeout=${1:-90} i
  for i in $(seq 1 "$timeout"); do
    panel_healthy && return 0
    sleep 1
  done
  return 1
}

# Tag the images the panel is running right now as :rollback, so a later
# `docker compose pull` (which overwrites :latest) can't erase the way back.
tag_rollback_images() {
  local svc img
  rm -f "$ROLLBACK_DIR/images.env"
  mkdir -p "$ROLLBACK_DIR"
  for svc in panel dashboard; do
    img=$(docker inspect -f '{{.Image}}' "tifusi-$svc" 2>/dev/null) || continue
    [ -n "$img" ] || continue
    docker tag "$img" "tifusi-panel-$svc:rollback" 2>/dev/null || continue
    if [ "$svc" = panel ]; then echo "TIFUSI_PANEL_IMAGE=tifusi-panel-panel:rollback" >> "$ROLLBACK_DIR/images.env"
    else echo "TIFUSI_DASHBOARD_IMAGE=tifusi-panel-dashboard:rollback" >> "$ROLLBACK_DIR/images.env"; fi
  done
}

# A full data snapshot (DB + .env + certs) kept only for this update, so a
# failed update can be put back exactly. Separate from `tifusi panel backup`,
# which the admin keeps.
snapshot_data() {
  mkdir -p "$ROLLBACK_DIR"
  if is_pro; then
    docker compose exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers tifusi' > "$ROLLBACK_DIR/mysql-dump.sql" 2>/dev/null       || { err "Couldn't snapshot the database — aborting the update before anything changed."; return 1; }
  fi
  tar czf "$ROLLBACK_DIR/data.tgz" data certs .env 2>/dev/null || tar czf "$ROLLBACK_DIR/data.tgz" data .env || true
  return 0
}

restore_data_snapshot() {
  [ -f "$ROLLBACK_DIR/data.tgz" ] || { err "No data snapshot to restore."; return 1; }
  local keep_mysql=""
  is_pro && keep_mysql="$(grep -E '^(TIFUSI_MYSQL_PASSWORD|TIFUSI_MYSQL_ROOT_PASSWORD|TIFUSI_DATABASE_URL)=' .env 2>/dev/null)"
  tar xzf "$ROLLBACK_DIR/data.tgz"
  if [ -n "$keep_mysql" ]; then
    grep -vE '^(TIFUSI_MYSQL_PASSWORD|TIFUSI_MYSQL_ROOT_PASSWORD|TIFUSI_DATABASE_URL)=' .env > .env.rb-tmp
    printf '%s
' "$keep_mysql" >> .env.rb-tmp; mv .env.rb-tmp .env; chmod 600 .env
  fi
  if is_pro && [ -f "$ROLLBACK_DIR/mysql-dump.sql" ]; then
    docker compose up -d mysql >/dev/null 2>&1
    local i
    for i in $(seq 1 90); do
      docker compose exec -T mysql sh -c 'mysqladmin ping -uroot -p"$MYSQL_ROOT_PASSWORD" --silent' >/dev/null 2>&1 && break
      sleep 2
    done
    docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" tifusi' < "$ROLLBACK_DIR/mysql-dump.sql" 2>/dev/null       || warn "Re-importing the database dump reported an error."
  fi
}

# Bring the panel back up on the images it ran before this update. Our
# migrations only ever add tables/columns, so the old code runs fine against
# the already-migrated schema — this keeps every write made since the
# snapshot. Only if the old code still can't come up (a rare destructive
# migration) do we fall back to restoring the whole data snapshot.
rollback_update() {
  warn "The new version did not come up healthy — rolling back."
  if [ -f "$ROLLBACK_DIR/images.env" ]; then
    info "Putting the previous images back..."
    env $(cat "$ROLLBACK_DIR/images.env" | xargs) docker compose up -d --no-deps panel dashboard >/dev/null 2>&1 || true
    if wait_healthy 60; then
      warn "Rolled back to the previous version (data kept). Your update did not take."
      return 0
    fi
    warn "Old images alone didn't recover — restoring the data snapshot too (writes since the update are lost)."
    docker compose down >/dev/null 2>&1 || true
    restore_data_snapshot
    env $(cat "$ROLLBACK_DIR/images.env" | xargs) docker compose up -d >/dev/null 2>&1 || true
    if wait_healthy 90; then
      warn "Rolled back to the previous version from the snapshot."
      return 0
    fi
  fi
  err "Rollback did not restore a healthy panel. The snapshot is kept at $ROLLBACK_DIR."
  err "Restore it by hand with: tifusi panel restore  (or inspect: tifusi panel logs)."
  return 1
}
action_update() {
  info "Checking for local changes..."
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    warn "This install has local changes (git status isn't clean) — not overwriting them."
    warn "Resolve or commit them yourself, then run this again. Skipping update."
    return
  fi
  info "Taking a safety snapshot before updating..."
  tag_rollback_images
  snapshot_data || return

  info "Pulling latest install files..."
  # fetch + reset: the public repository's history was restarted when the source went private,
  # so an older copy can't fast-forward. .env, data/ and certs/ are untracked and kept.
  git fetch --depth 1 origin main && git reset --hard FETCH_HEAD
  # A pull alone leaves tifusi-panel and the shared launcher at the previously installed version.
  source scripts/install-commands.sh
  install_panel_commands
  info "Pulling prebuilt images..."
  if ! docker compose pull; then
    warn "Couldn't download the images from ghcr.io — check this server's internet access and run the update again."
    return
  fi
  info "Restarting with the new version..."
  docker compose up -d

  info "Waiting for the new version to come up..."
  if wait_healthy 90; then
    info "Updated to $(cat backend/VERSION 2>/dev/null || echo '?') — healthy."
    info "The rollback snapshot is kept at $ROLLBACK_DIR until the next update."
    send_update_report ok
  elif rollback_update; then
    send_update_report rolled_back
  fi
}

# Best-effort Telegram report from inside the panel; never fails the update.
send_update_report() {
  docker exec tifusi-panel tifusi-cli update-report "$1" >/dev/null 2>&1 || true
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
  if ! docker ps --format '{{.Names}}' | grep -qx tifusi-panel; then
    err "The panel container isn't running — start it first with 'tifusi panel restart'."
    return
  fi
  info "Requesting a Let's Encrypt certificate for $domain (port 80 must reach this server)..."
  mkdir -p certs
  CERT_LOG="$(mktemp)"
  # Run inside the panel container, which is the one publishing host port 80.
  # A separate certbot container asking Docker for that same port can never
  # get it while the panel is up, so this used to fail on every running
  # install. Same paths the panel's own Settings > SSL button uses.
  local acme=/app/data/letsencrypt
  # --key-type rsa: see install.sh's own SSL step for why — a node's
  # strongSwan can't parse an ECDSA cert if this one later gets reused as
  # an IKEv2 Core's certificate.
  if docker exec tifusi-panel certbot certonly --standalone --non-interactive --agree-tos \
    --key-type rsa --rsa-key-size 2048 \
    --config-dir "$acme/config" --work-dir "$acme/work" --logs-dir "$acme/logs" \
    -m "admin@${domain}" -d "$domain" > "$CERT_LOG" 2>&1; then
    cat "$CERT_LOG"
    # ./certs is mounted into both containers; the dashboard watches it and
    # starts serving HTTPS without a restart.
    docker exec tifusi-panel sh -c \
      "cp $acme/config/live/$domain/fullchain.pem /app/certs/fullchain.pem && cp $acme/config/live/$domain/privkey.pem /app/certs/privkey.pem"
    if grep -q '^TIFUSI_PUBLIC_URL=' .env; then
      sed -i "s#^TIFUSI_PUBLIC_URL=.*#TIFUSI_PUBLIC_URL=https://${domain}#" .env
    else
      echo "TIFUSI_PUBLIC_URL=https://${domain}" >> .env
    fi
    # .env alone doesn't move an already-running panel: the address it builds
    # subscription links from lives in its database.
    docker exec tifusi-panel tifusi-cli set-public-url "https://${domain}" >/dev/null 2>&1 \
      || warn "Set the panel's address to https://${domain} under Settings — links still use the old one."
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

action_edit_env() {
  local editor=${EDITOR:-}
  if [ -z "$editor" ]; then
    for candidate in nano vi vim; do
      command -v "$candidate" >/dev/null 2>&1 && { editor=$candidate; break; }
    done
  fi
  [ -n "$editor" ] || { err "No editor found — install nano, or edit $INSTALL_DIR/.env by hand."; return; }

  info "Opening $INSTALL_DIR/.env in $editor. Save and close to apply."
  warn "The panel keeps its public address in its own database, so editing"
  warn "TIFUSI_PUBLIC_URL here changes nothing — use Settings in the dashboard,"
  warn "or: docker exec tifusi-panel tifusi-cli set-public-url https://your-address"
  echo
  read -r -p "Press Enter to open it..." _

  # Kept so a bad edit (a stray quote, a deleted password) can be put back
  # without the panel's own data being at risk in between.
  local backup="$INSTALL_DIR/.env.bak"
  cp .env "$backup"
  "$editor" .env

  if cmp -s "$backup" .env; then
    info "No changes made."
    rm -f "$backup"
    return
  fi
  info "Applying (recreating containers)..."
  if docker compose up -d; then
    info "Applied. The previous file is kept at $backup"
  else
    err "The containers didn't come up with the new file."
    read -r -p "Put the previous .env back and restart? [Y/n] " revert
    if [[ "${revert:-Y}" =~ ^[Yy]$ ]]; then
      mv -f "$backup" .env
      docker compose up -d && info "Reverted."
    fi
  fi
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

# The offline node bundle (scripts/build-node-bundle.sh) for servers that can't
# reach GitHub/ghcr/apt; the panel serves it from data/node-bundle/ and uploads
# it from a node's "Install over SSH" sheet.
action_node_bundle() {
  if [ ! -f scripts/build-node-bundle.sh ]; then
    err "scripts/build-node-bundle.sh is missing — update the panel first (tifusi panel update)."
    return 1
  fi
  info "Building the offline node bundle (node image, Docker, packages, tunnel binaries)..."
  bash scripts/build-node-bundle.sh
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
  printf '  %s11)%s Edit the settings file (.env)\n' "$C_GREEN" "$C_RESET"
  printf '  %s12)%s Uninstall panel completely\n' "$C_GREEN" "$C_RESET"
  printf '  %s13)%s Build the offline node bundle\n' "$C_GREEN" "$C_RESET"
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
    11) action_edit_env ;;
    12) action_uninstall ;;
    13) action_node_bundle ;;
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
  env) action_edit_env ;;
  uninstall) action_uninstall ;;
  node-bundle) action_node_bundle ;;
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
