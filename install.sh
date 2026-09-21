#!/usr/bin/env bash
# Tifusi Panel installer — clones the repo and brings the panel up with
# Docker Compose. The admin account itself is created from the browser's
# login page, using a one-time key from `tifusi-cli generate-admin-key` —
# this script just gets the panel running and hands you that command.
#
# Usage:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install.sh)"
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install.sh)" -- --pro
#
# --pro installs the professional edition: the same panel with its data in a
# bundled MySQL 8.4 container instead of the built-in SQLite file.

set -euo pipefail

REPO_URL="https://github.com/javadtifusi-eng/Tifusi-Panel.git"
INSTALL_DIR="${TIFUSI_INSTALL_DIR:-/opt/tifusi-panel}"
EDITION="standard"
for arg in "$@"; do
  case "$arg" in
    --pro) EDITION="pro" ;;
    --) ;;
    *) printf 'Unknown option: %s (use --pro for the professional edition)\n' "$arg" >&2; exit 1 ;;
  esac
done
# Set for real in the "Ports" step below, once the chosen panel port is known.
PANEL_URL=""

# Only emit color/box-drawing escapes into a real, color-capable terminal —
# piped into a log file or a dumb terminal, raw escape codes are exactly
# the "garbled unclear lines" this is here to avoid.
IS_TTY=""
[ -t 1 ] && [ -z "${NO_COLOR:-}" ] && IS_TTY=1

if [ -n "$IS_TTY" ]; then
  C_CYAN=$'\033[1;36m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[1;31m'; C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'; C_GREEN=$'\033[1;32m'
else
  C_CYAN=""; C_YELLOW=""; C_RED=""; C_RESET=""; C_BOLD=""; C_GREEN=""
fi

info() { printf '%s[Tifusi]%s %s\n' "$C_CYAN" "$C_RESET" "$1"; }
warn() { printf '%s[Warning]%s %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
fail() { printf '%s[Error]%s %s\n' "$C_RED" "$C_RESET" "$1"; exit 1; }

# Green for both installers, cyan for the admin key command.
C_ACCENT=$C_GREEN

# ── Progress UI ──────────────────────────────────────────────────────────
# Unicode bars (━) where the terminal can draw them, plain ASCII ([===>  ])
# where it can't — an old phone SSH client or a datacenter web console with
# no UTF-8 locale would otherwise show "?" or broken glyphs. TIFUSI_ASCII=1
# forces the ASCII style. Everything redraws on one line, sized to the
# terminal's width so a narrow phone screen doesn't wrap it into a mess.
UI_UNICODE=""
if [ -n "$IS_TTY" ] && [ -z "${TIFUSI_ASCII:-}" ] \
  && printf '%s' "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" | grep -qiE 'utf-?8'; then
  UI_UNICODE=1
fi
C_DIM=""; [ -n "$IS_TTY" ] && C_DIM=$'\033[2m'
if [ -n "$UI_UNICODE" ]; then UI_OK="✔"; UI_FAIL="✘"; else UI_OK="[OK]"; UI_FAIL="[FAIL]"; fi

_rep() { local s="" i; for ((i = 0; i < $1; i++)); do s+="$2"; done; printf '%s' "$s"; }
_cols() { local c; c=$(tput cols 2>/dev/null || true); [[ "$c" =~ ^[0-9]+$ ]] && [ "$c" -gt 0 ] && echo "$c" || echo 80; }
_clock() { printf '%02d:%02d' $(($1 / 60)) $(($1 % 60)); }
_took() { if [ "$1" -ge 60 ]; then printf '%dm %ds' $(($1 / 60)) $(($1 % 60)); else printf '%ds' "$1"; fi; }
_mb() { printf '%d' $((($1 + 524288) / 1048576)); }

# A bar `width` cells wide at `permille` (0-1000).
_bar() {
  local pm=$1 w=$2 full
  full=$((pm * w / 1000))
  if [ -n "$UI_UNICODE" ]; then
    if [ "$full" -ge "$w" ]; then printf '%s%s%s' "$C_ACCENT" "$(_rep "$w" '━')" "$C_RESET"; return; fi
    printf '%s%s╸%s%s%s%s' "$C_ACCENT" "$(_rep "$full" '━')" "$C_RESET" "$C_DIM" "$(_rep $((w - full - 1)) '━')" "$C_RESET"
  else
    if [ "$full" -ge "$w" ]; then printf '[%s]' "$(_rep "$w" '=')"; return; fi
    printf '[%s%s%s]' "$(_rep $((full > 0 ? full - 1 : 0)) '=')" "$([ "$full" -gt 0 ] && echo '>')" "$(_rep $((w - full)) ' ')"
  fi
}

# A bar with no known end: a lit segment sweeping across (Unicode) or a
# bouncing <=> (ASCII), driven by the frame counter `tick`.
_sweep() {
  local tick=$1 w=$2 i out=""
  if [ -n "$UI_UNICODE" ]; then
    local pos=$((tick % (w + 6) - 6))
    for ((i = 0; i < w; i++)); do
      if [ "$i" -ge "$pos" ] && [ "$i" -lt $((pos + 6)) ]; then out+="$C_ACCENT━$C_RESET"; else out+="$C_DIM━$C_RESET"; fi
    done
    printf '%s' "$out"
  else
    local span=$((w - 3)) pos
    [ "$span" -lt 1 ] && span=1
    pos=$((tick % (span * 2))); [ "$pos" -gt "$span" ] && pos=$((span * 2 - pos))
    printf '[%s<=>%s]' "$(_rep "$pos" ' ')" "$(_rep $((w - 3 - pos)) ' ')"
  fi
}

# Draws "message  bar  tail" on the current line, giving the bar whatever
# width is left; drops the bar entirely on a terminal too narrow for it.
_draw() {
  local msg="$1" tail="$2" kind="$3" value="$4" cols w
  cols=$(_cols)
  w=$((cols - ${#msg} - ${#tail} - 6))
  [ "$w" -gt 34 ] && w=34
  local bar=""
  if [ "$w" -ge 8 ]; then
    if [ "$kind" = sweep ]; then bar=$(_sweep "$value" "$w"); else bar=$(_bar "$value" "$w"); fi
    bar="  $bar"
  fi
  printf '\r\033[K%s%s  %s%s%s' "$msg" "$bar" "$C_DIM" "$tail" "$C_RESET"
}

_finish_line() {
  local status=$1 msg="$2" detail="$3"
  msg="${msg%...}"
  if [ "$status" -eq 0 ]; then
    printf '\r\033[K%s%s%s %s  %s%s%s\n' "$C_GREEN" "$UI_OK" "$C_RESET" "$msg" "$C_DIM" "$detail" "$C_RESET"
  else
    printf '\r\033[K%s%s%s %s\n' "$C_RED" "$UI_FAIL" "$C_RESET" "$msg"
  fi
}

# Runs a command in the background behind a sweeping bar and a clock; on
# failure prints the command's own output so the error is still visible.
run_spinner() {
  local msg="$1"; shift
  local log start tick=0 status=0
  log="$(mktemp)"; start=$SECONDS
  "$@" >"$log" 2>&1 &
  local pid=$!
  if [ -n "$IS_TTY" ]; then
    while kill -0 "$pid" 2>/dev/null; do
      _draw "$msg" "$(_clock $((SECONDS - start)))" sweep "$tick"
      tick=$((tick + 1))
      sleep 0.1
    done
  else
    printf '%s\n' "$msg"
  fi
  wait "$pid" || status=$?
  _finish_line "$status" "$msg" "$(_took $((SECONDS - start)))"
  [ "$status" -eq 0 ] || cat "$log"
  rm -f "$log"
  return "$status"
}

# Compressed layer sizes of an image straight from its registry, as
# "<12-char layer id> <bytes>" lines in file $2; prints the total. This is
# what makes the percentage honest: layers differ wildly in size, so a
# layer count alone would jump from 10% to 80% in one step.
_registry_layers() {
  local ref="$1" out="$2" host rest repo tag arch auth realm service token man digest
  local accept='application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json'
  host=${ref%%/*}; rest=${ref#*/}
  case "$host" in *.*) ;; *) return 1 ;; esac
  tag=latest; repo=$rest
  case "${rest##*/}" in *:*) tag=${rest##*:}; repo=${rest%:*} ;; esac
  case "$(uname -m)" in aarch64 | arm64) arch=arm64 ;; *) arch=amd64 ;; esac
  auth=$(curl -sS -m 15 -o /dev/null -D - -H "Accept: $accept" "https://$host/v2/$repo/manifests/$tag" | tr -d '\r' | grep -i '^www-authenticate:') || return 1
  realm=$(printf '%s' "$auth" | sed -n 's/.*realm="\([^"]*\)".*/\1/p')
  service=$(printf '%s' "$auth" | sed -n 's/.*service="\([^"]*\)".*/\1/p')
  token=$(curl -fsS -m 15 "$realm?service=$service&scope=repository:$repo:pull" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  [ -n "$token" ] || return 1
  # Registries may pretty-print; flattening whitespace puts each JSON object
  # on one line once split on "{", so a layer's digest and size stay together.
  man=$(curl -fsS -m 15 -H "Authorization: Bearer $token" -H "Accept: $accept" "https://$host/v2/$repo/manifests/$tag" | tr -d ' \t\r\n') || return 1
  if printf '%s' "$man" | grep -q '"manifests"'; then
    digest=$(printf '%s' "$man" | tr ',{}' '\n\n\n' \
      | awk -v a="\"$arch\"" '/"digest"/ { d = $0 } /"architecture"/ && index($0, a) { print d; exit }' \
      | grep -o 'sha256:[0-9a-f]*')
    [ -n "$digest" ] || return 1
    man=$(curl -fsS -m 15 -H "Authorization: Bearer $token" -H "Accept: $accept" "https://$host/v2/$repo/manifests/$digest" | tr -d ' \t\r\n') || return 1
  fi
  printf '%s' "$man" | tr '{' '\n' | awk -v out="$out" '
    L && match($0, /"size": *[0-9]+/) {
      s = substr($0, RSTART, RLENGTH); gsub(/[^0-9]/, "", s)
      if (match($0, /sha256:[0-9a-f]+/)) { print substr($0, RSTART + 7, 12), s > out; t += s }
    }
    index($0, "\"layers\"") { L = 1 }
    END { if (t > 0) print t; else exit 1 }'
}

# Pulls images through the Docker Engine API, which reports per-layer byte
# counts (the `docker pull` CLI shows none when it isn't drawing to a
# terminal), and renders one bar with percent, MB and time left across all
# of them. Returns non-zero if any pull fails, so the caller can fall back
# to building locally. Falls back itself to a plain `docker pull` behind a
# sweeping bar when the socket API or the registry sizes aren't reachable.
pull_with_progress() {
  local msg="$1"; shift
  local dir start grand=0 known=1 img i=0 sz
  local -a sizes=()
  dir="$(mktemp -d)"; start=$SECONDS
  if [ -z "$IS_TTY" ] || [ ! -S /var/run/docker.sock ] || ! curl -s --unix-socket /var/run/docker.sock -o /dev/null http://localhost/_ping; then
    rm -rf "$dir"
    run_spinner "$msg" sh -c 'for i in "$@"; do docker pull -q "$i" || exit 1; done' _ "$@"
    return
  fi
  for img in "$@"; do
    sz=$(_registry_layers "$img" "$dir/map$i" 2>/dev/null) || { sz=0; known=""; : >"$dir/map$i"; }
    sizes[i]=$sz; grand=$((grand + sz)); i=$((i + 1))
  done
  [ -n "$known" ] || grand=0

  local offset=0 status=0 tick=0
  i=0
  for img in "$@"; do
    local name=${img%:*} tag=latest state="$dir/state$i" err="$dir/err$i"
    case "${img##*/}" in *:*) tag=${img##*:} ;; *) name=$img ;; esac
    : >"$state"
    curl -sS -N --unix-socket /var/run/docker.sock -X POST \
      "http://localhost/images/create?fromImage=${name}&tag=${tag}" 2>"$err" \
      | awk -v map="$dir/map$i" -v state="$state" -v errf="$err" '
          BEGIN { while ((getline l < map) > 0) { split(l, a, " "); size[a[1]] = a[2] } }
          {
            id = ""; st = ""
            if (match($0, /"id":"[^"]*"/)) id = substr($0, RSTART + 6, RLENGTH - 7)
            if (match($0, /"status":"[^"]*"/)) st = substr($0, RSTART + 10, RLENGTH - 11)
            if (index($0, "\"errorDetail\"") || index($0, "\"message\"")) {
              e = 1; m = $0
              if (match($0, /"message":"[^"]*"/)) m = substr($0, RSTART + 11, RLENGTH - 12)
              print m > errf; close(errf)
            }
            if (length(id) == 12) {
              if (!(id in seen)) { seen[id] = 1; n++ }
              if (st == "Downloading" && match($0, /"current":[0-9]+/)) {
                cur[id] = substr($0, RSTART + 10, RLENGTH - 10) + 0
                if ((id in size) && cur[id] > size[id] + 0) cur[id] = size[id] + 0
              }
              if (st == "Download complete" || st == "Pull complete" || st == "Already exists") { if (id in size) cur[id] = size[id] }
              if ((st == "Pull complete" || st == "Already exists") && !(id in fin)) { fin[id] = 1; d++ }
            }
            b = 0; for (k in cur) b += cur[k]
            printf "%d %d %d %d\n", b, d, n, e > state; close(state)
          }' &
    local pid=$! b=0 d=0 n=0 e=0
    while kill -0 "$pid" 2>/dev/null; do
      local rb rd rn re el tail pm
      # awk rewrites the state file on every event; a read that catches it
      # mid-rewrite comes back empty, so the last good values are kept.
      if read -r rb rd rn re <"$state" 2>/dev/null && [ -n "$re" ]; then b=$rb; d=$rd; n=$rn; e=$re; fi
      el=$((SECONDS - start))
      if [ "$grand" -gt 0 ]; then
        pm=$(((offset + b) * 1000 / grand)); [ "$pm" -gt 1000 ] && pm=1000
        tail="$(printf '%3d%%' $((pm / 10)))  $(_mb $((offset + b)))/$(_mb "$grand") MB"
        if [ "$pm" -ge 30 ] && [ "$pm" -lt 1000 ]; then tail+="  eta $(_clock $((el * (1000 - pm) / pm)))"; fi
        _draw "$msg" "$tail" bar "$pm"
      else
        tail="$(_mb $((offset + b))) MB  $d/$n layers  $(_clock "$el")"
        _draw "$msg" "$tail" sweep "$tick"
      fi
      tick=$((tick + 1))
      sleep 0.1
    done
    wait "$pid" || true
    if read -r rb rd rn re <"$state" 2>/dev/null && [ -n "$re" ]; then b=$rb; n=$rn; e=$re; fi
    # Content already in Docker's store (a reinstall) produces no layer
    # events at all; the whole image counts as done.
    [ "${n:-0}" -eq 0 ] && b=${sizes[i]:-0}
    if [ "${e:-0}" != 0 ] || ! docker image inspect "$img" >/dev/null 2>&1; then
      status=1
      break
    fi
    offset=$((offset + b)); i=$((i + 1))
  done

  if [ "$status" -eq 0 ]; then
    _finish_line 0 "$msg" "$(_mb "$offset") MB · $(_took $((SECONDS - start)))"
  else
    _finish_line 1 "$msg" ""
    cat "$dir"/err* 2>/dev/null | grep -v '^$' | tail -n 3 || true
  fi
  rm -rf "$dir"
  return "$status"
}

# One header per install phase: "▸ 3/8 ■■■□□□□□ Title" (or "> 3/8 [###-----]").
STEP_NUM=0
step() {
  STEP_NUM=$((STEP_NUM + 1))
  local f=$((STEP_NUM * 8 / STEP_TOTAL))
  if [ -n "$UI_UNICODE" ]; then
    printf '\n%s▸ %d/%d%s  %s%s%s%s%s  %s%s%s\n' "$C_ACCENT$C_BOLD" "$STEP_NUM" "$STEP_TOTAL" "$C_RESET" \
      "$C_ACCENT" "$(_rep "$f" '■')" "$C_DIM" "$(_rep $((8 - f)) '□')" "$C_RESET" "$C_BOLD" "$1" "$C_RESET"
  else
    printf '\n%s> %d/%d  [%s%s]%s  %s\n' "$C_ACCENT$C_BOLD" "$STEP_NUM" "$STEP_TOTAL" "$(_rep "$f" '#')" "$(_rep $((8 - f)) '-')" "$C_RESET" "$1"
  fi
}
done_line() { printf '%s%s%s %s\n' "$C_GREEN" "$UI_OK" "$C_RESET" "$1"; }
# ── end Progress UI ──────────────────────────────────────────────────────

# Renders `lines` inside a box-drawing rectangle wide enough for its widest
# line, titled and colored — used for the SSL summary below so the cert
# paths/fingerprint/content read as one clear block instead of scattered
# log lines the way certbot's own raw output does.
# A titled block of lines — no frame, so a narrow phone SSH window can't
# break the drawing, and the values stay easy to select and copy.
print_block() {
  local title="$1" color="$2"; shift 2
  printf '\n%s%s%s%s\n' "$color" "$C_BOLD" "$title" "$C_RESET"
  local line
  for line in "$@"; do printf '  %s\n' "$line"; done
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

  print_block "Fullchain.pem" "$C_CYAN" "${cert_lines[@]}"
  print_block "Privkey.pem (info only, not the raw key)" "$C_YELLOW" "${privkey_info[@]}"
  print_block "Panel Access Info" "$C_GREEN" "Dashboard :  $public_url" "Port      :  $dash_port"
}

# apt-get update used to be a step of its own, but nothing here installs an
# apt package, so it only added a minute or more of waiting before anything
# happened.
STEP_TOTAL=8

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
  printf '\n%s%s%s\n' "$C_GREEN$C_BOLD" "$_BIG_TIFUSI" "$C_RESET"
  printf '%s  Tifusi Panel installer%s\n' "$C_GREEN" "$C_RESET"
}

banner

step "Docker"
if command -v docker >/dev/null 2>&1; then
  done_line "Docker is already installed"
else
  run_spinner "Installing Docker (official script)..." \
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
  run_spinner "Updating the existing copy in $INSTALL_DIR..." git -C "$INSTALL_DIR" pull --ff-only || exit 1
else
  run_spinner "Downloading Tifusi Panel into $INSTALL_DIR..." git clone --depth 1 "$REPO_URL" "$INSTALL_DIR" || exit 1
fi

cd "$INSTALL_DIR"

step "Configuration (.env)"
random_hex() { openssl rand -hex "$1" 2>/dev/null || head -c"$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(random_hex 32)
  awk -v s="$SECRET" '{gsub(/^TIFUSI_SECRET_KEY=.*/, "TIFUSI_SECRET_KEY=" s)}1' .env > .env.tmp
  mv .env.tmp .env
  info "Generated a random TIFUSI_SECRET_KEY in .env."
  if [ "$EDITION" = "pro" ]; then
    # Hex-only passwords: they sit inside a database URL and Alembic's
    # config parser, where characters like % or @ would need escaping.
    MYSQL_PASSWORD=$(random_hex 24)
    MYSQL_ROOT_PASSWORD=$(random_hex 24)
    grep -v '^TIFUSI_DATABASE_URL=' .env > .env.tmp
    {
      echo ""
      echo "# Professional edition (install.sh --pro): data lives in the bundled MySQL."
      echo "TIFUSI_EDITION=pro"
      echo "COMPOSE_FILE=docker-compose.yml:docker-compose.pro.yml"
      echo "TIFUSI_MYSQL_PASSWORD=$MYSQL_PASSWORD"
      echo "TIFUSI_MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASSWORD"
      echo "TIFUSI_DATABASE_URL=mysql+aiomysql://tifusi:${MYSQL_PASSWORD}@mysql:3306/tifusi?charset=utf8mb4"
    } >> .env.tmp
    mv .env.tmp .env
    info "Professional edition: generated MySQL passwords and pointed the panel at the bundled MySQL."
  fi
elif [ "$EDITION" = "pro" ] && ! grep -q '^TIFUSI_EDITION=pro' .env; then
  warn "An existing standard (SQLite) install was found — --pro only applies to a fresh install, so it keeps its current database."
  EDITION="standard"
fi
grep -q '^TIFUSI_EDITION=pro' .env && EDITION="pro"

step "Ports"
# A port already in use on this server would make the container fail to
# start later with a confusing Docker error — check now instead, and if
# the caller just hits Enter (wants the default), pick the next free port
# starting from it rather than blindly handing back something taken.
# Whichever tool this host has, asked once — never both. Chained with `||`,
# a port ss reports as free still got a second opinion from lsof, and
# BusyBox's lsof (Alpine and other minimal images) ignores these flags and
# exits 0 whatever it is asked, which reads back as "every port is taken".
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
  # Bounded: a broken port check used to walk ports forever here, with the
  # installer sitting silent at the prompt and no way to tell what happened.
  while [ "$p" -le 65535 ] && port_in_use "$p"; do p=$((p + 1)); done
  [ "$p" -le 65535 ] || fail "Couldn't find a free port at or above $1."
  echo "$p"
}
# docker-compose.yml publishes 80 and 443 itself — certbot's HTTP-01 challenge
# on the panel, the dashboard's HTTPS listener — so picking either here gives
# one host port two bindings and the container can never start ("port is
# already allocated"). Nothing is listening on them yet at this point in the
# install, so port_in_use cannot catch this on its own.
port_reserved() { [ "$1" = 80 ]; }

# Ports already handed out earlier in this same run. Docker would only notice
# the clash when the container fails to start, at the very end of the install.
CHOSEN_PORTS=()
port_taken_here() {
  local p
  for p in ${CHOSEN_PORTS[@]+"${CHOSEN_PORTS[@]}"}; do [ "$p" = "$1" ] && return 0; done
  return 1
}

# A free port drawn from the high range, so two installs don't land on the
# same handful of well-known defaults. $RANDOM only reaches 32767, hence the
# pair of draws to cover the whole range.
random_free_port() {
  local p tries
  for tries in $(seq 1 200); do
    p=$(( (RANDOM * 32768 + RANDOM) % 45001 + 20000 ))
    port_reserved "$p" && continue
    port_taken_here "$p" && continue
    port_in_use "$p" || { echo "$p"; return; }
  done
  fail "Couldn't find a free random port after 200 tries."
}

ask_port() {
  local label=$1 default=$2 target=$3 value
  while true; do
    # A non-interactive stdin makes read fail rather than block; fall back to
    # the auto-pick instead of spinning on EOF forever.
    read -r -p "$label (Enter for $default, 'r' for a random one, or type a port): " value || value=""
    if [ -z "$value" ]; then
      value=$(next_free_port "$default")
      info "Using port $value."
      break
    elif [ "$value" = r ] || [ "$value" = R ]; then
      value=$(random_free_port)
      info "Picked random port $value."
      break
    elif ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt 1 ] || [ "$value" -gt 65535 ]; then
      warn "'$value' isn't a valid port number."
    elif port_reserved "$value"; then
      warn "Port $value is reserved — the panel answers Let's Encrypt on it."
    elif port_taken_here "$value"; then
      warn "Port $value is already going to another Tifusi service — pick a different one."
    elif port_in_use "$value"; then
      warn "Port $value is already in use on this server — pick a different one."
    else
      break
    fi
  done
  CHOSEN_PORTS+=("$value")
  printf -v "$target" '%s' "$value"
}

ask_port "Panel API port" 8000 panel_port
ask_port "Dashboard HTTP port" 8080 dashboard_port
# Its own prompt because a server behind Cloudflare's proxy can only be
# reached on 443/2053/2083/2087/2096/8443 — pinning HTTPS to 443 left those
# installs with no way to serve the dashboard on a port Cloudflare would talk to.
ask_port "Dashboard HTTPS port" 443 dashboard_https_port
awk -v p="$panel_port" -v d="$dashboard_port" -v s="$dashboard_https_port" '
  /^#? *TIFUSI_PANEL_PORT=/ { print "TIFUSI_PANEL_PORT=" p; next }
  /^#? *TIFUSI_DASHBOARD_PORT=/ { print "TIFUSI_DASHBOARD_PORT=" d; next }
  /^#? *TIFUSI_DASHBOARD_HTTPS_PORT=/ { print "TIFUSI_DASHBOARD_HTTPS_PORT=" s; next }
  { print }
' .env > .env.tmp
grep -q '^TIFUSI_PANEL_PORT=' .env.tmp || echo "TIFUSI_PANEL_PORT=$panel_port" >> .env.tmp
grep -q '^TIFUSI_DASHBOARD_PORT=' .env.tmp || echo "TIFUSI_DASHBOARD_PORT=$dashboard_port" >> .env.tmp
grep -q '^TIFUSI_DASHBOARD_HTTPS_PORT=' .env.tmp || echo "TIFUSI_DASHBOARD_HTTPS_PORT=$dashboard_https_port" >> .env.tmp
mv .env.tmp .env
PANEL_URL="http://localhost:${panel_port}"
info "Panel API on port $panel_port, dashboard on $dashboard_port (HTTP) and $dashboard_https_port (HTTPS)."

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
      # Issued straight into the panel's own ACME directory, at the paths the
      # panel container sees (./data is its /app/data), so the panel's
      # automatic renewal (backend/app/tls_renewal.py) picks it up as is.
      mkdir -p certs data/letsencrypt
      CERT_LOG="$(mktemp)"
      # --key-type rsa: not certbot's own ECDSA default — this cert can end
      # up reused as an IKEv2 Core's certificate (Cores > "Use panel's
      # domain certificate"), and strongSwan on a node has no EC plugin
      # compiled in, so an ECDSA cert there fails outright ("parsing X509
      # certificate failed", confirmed live). RSA works identically for
      # the dashboard's own HTTPS.
      if docker run --rm -p 80:80 -v "$(pwd)/data/letsencrypt:/app/data/letsencrypt" \
        certbot/certbot certonly --standalone --non-interactive --agree-tos \
        --key-type rsa --rsa-key-size 2048 \
        --config-dir /app/data/letsencrypt/config --work-dir /app/data/letsencrypt/work \
        --logs-dir /app/data/letsencrypt/logs \
        -m "admin@${domain}" -d "$domain" > "$CERT_LOG" 2>&1; then
        # Certbot's own "Congratulations" box already states exactly where
        # the cert and key ended up — show it instead of just our one-line
        # paraphrase of it, the way every other panel's installer does.
        cat "$CERT_LOG"
        cp "data/letsencrypt/config/live/${domain}/fullchain.pem" certs/fullchain.pem
        cp "data/letsencrypt/config/live/${domain}/privkey.pem" certs/privkey.pem
        # Only 443 is implied by "https://host" — on any other port the
        # subscription links the panel hands to clients have to name it.
        if [ "$dashboard_https_port" = 443 ]; then
          PANEL_PUBLIC_URL="https://${domain}"
        else
          PANEL_PUBLIC_URL="https://${domain}:${dashboard_https_port}"
        fi
        echo "TIFUSI_PUBLIC_URL=${PANEL_PUBLIC_URL}" >> .env
        show_ssl_summary "$(pwd)/certs/fullchain.pem" "$(pwd)/certs/privkey.pem" "$PANEL_PUBLIC_URL" "$dashboard_https_port"
        info "The panel renews this certificate on its own before it expires (port 80 has to stay reachable)."
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

step "Panel images"
# Same image names docker-compose.yml resolves (an .env override included).
env_value() { { grep -E "^$1=" .env 2>/dev/null || true; } | tail -n 1 | cut -d= -f2-; }
PANEL_IMAGE="$(env_value TIFUSI_PANEL_IMAGE)"; PANEL_IMAGE="${PANEL_IMAGE:-ghcr.io/javadtifusi-eng/tifusi-panel-backend:latest}"
DASHBOARD_IMAGE="$(env_value TIFUSI_DASHBOARD_IMAGE)"; DASHBOARD_IMAGE="${DASHBOARD_IMAGE:-ghcr.io/javadtifusi-eng/tifusi-panel-frontend:latest}"
if pull_with_progress "Downloading panel images..." "$PANEL_IMAGE" "$DASHBOARD_IMAGE"; then
  BUILD_CMD=(docker compose up -d)
  START_MSG="Starting containers..."
else
  info "Prebuilt images aren't available (offline registry, or this repo's Packages aren't Public yet) — building locally instead. This can take a few minutes."
  BUILD_CMD=(docker compose up -d --build)
  START_MSG="Building & starting containers..."
fi
run_spinner "$START_MSG" "${BUILD_CMD[@]}" || exit 1

step "Management command"
mkdir -p /etc/tifusi-panel
echo "$INSTALL_DIR" > /etc/tifusi-panel/install_dir
source scripts/install-commands.sh
install_panel_commands
done_line "Installed the 'tifusi panel' command"

step "Health check"
wait_for_panel() {
  local _
  # The pro edition waits for MySQL's first-time initialisation before the panel starts.
  for _ in $(seq 1 $([ "$EDITION" = "pro" ] && echo 150 || echo 60)); do
    curl -fsSk "$PANEL_URL/api/setup/status" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}
run_spinner "Waiting for the panel to come up..." wait_for_panel \
  || fail "The panel didn't come up in time — check the logs: docker compose logs panel"

# `hostname -I` is a GNU extension: BusyBox rejects it outright, and under
# `set -e` that killed the installer here — after everything was already
# running, so the admin never saw the address or how to create their account.
HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
[ -n "$HOST_IP" ] || HOST_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"
HOST_IP="${HOST_IP:-<server-ip>}"
SUMMARY=()
if [ "$EDITION" = "pro" ]; then
  SUMMARY+=("Edition   :  professional (MySQL 8.4, data in ${INSTALL_DIR}/mysql-data)")
else
  SUMMARY+=("Edition   :  standard (SQLite, data in ${INSTALL_DIR}/data)")
fi
if [ -n "$PANEL_PUBLIC_URL" ]; then
  SUMMARY+=("SSL       :  enabled (Let's Encrypt, ${domain:-})")
  SUMMARY+=("Certs     :  ${INSTALL_DIR}/certs/fullchain.pem + privkey.pem")
  SUMMARY+=("Dashboard :  $PANEL_PUBLIC_URL")
else
  SUMMARY+=("Dashboard :  http://${HOST_IP}:${dashboard_port}")
fi
SUMMARY+=("Panel API :  http://${HOST_IP}:${panel_port}")
print_block "Panel Access Info" "$C_GREEN" "${SUMMARY[@]}"
printf '\n'
info "To create the admin account, open the dashboard in your browser, then run this to get a one-time setup key:"
info "  tifusi panel key"
info "Paste that key into the login page along with the username/password you want, and you're in."
info ""
info "Run 'tifusi panel' any time (updates, ports, SSL, backups, uninstall) — with no arguments it opens a menu."
info "Done."
