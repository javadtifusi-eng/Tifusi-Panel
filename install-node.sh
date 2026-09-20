#!/usr/bin/env bash
# Tifusi node-agent installer — for a server that actually runs Xray-core
# and takes config pushes from a Tifusi Panel running elsewhere. Create the
# node from the panel's Nodes page first (+ node) to get its API key.
#
# Usage:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install-node.sh)" -- <API_KEY> [PORT]

set -euo pipefail

REPO_URL="https://github.com/javadtifusi-eng/Tifusi-Panel.git"
RAW_BASE="https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main"
CLONE_DIR="$(mktemp -d)"
trap 'rm -rf "$CLONE_DIR"' EXIT

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
# Green for the node installer, magenta for the panel's, cyan for the admin
# key command — the color alone tells which one produced the screen.
C_ACCENT=$C_GREEN

info() { printf '%s[Tifusi Node]%s %s\n' "$C_CYAN" "$C_RESET" "$1"; }
warn() { printf '%s[Warning]%s %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
fail() { printf '%s[Error]%s %s\n' "$C_RED" "$C_RESET" "$1"; exit 1; }

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

# A titled block of lines — no frame, so a narrow phone SSH window can't
# break the drawing, and the values stay easy to select and copy.
print_block() {
  local title="$1" color="$2"; shift 2
  printf '\n%s%s%s%s\n' "$color" "$C_BOLD" "$title" "$C_RESET"
  local line
  for line in "$@"; do printf '  %s\n' "$line"; done
}

# Same big block-letter "TIFUSI" (figlet -f big) as the panel installer,
# which draws it in magenta; green here.
_BIG_TIFUSI='
 _______ _____ ______ _    _  _____ _____
|__   __|_   _|  ____| |  | |/ ____|_   _|
   | |    | | | |__  | |  | | (___   | |
   | |    | | |  __| | |  | |\___ \  | |
   | |   _| |_| |    | |__| |____) |_| |_
   |_|  |_____|_|     \____/|_____/|_____|
'
printf '\n%s%s%s\n' "$C_GREEN$C_BOLD" "$_BIG_TIFUSI" "$C_RESET"
printf '%s  Tifusi Node installer%s\n' "$C_GREEN" "$C_RESET"

API_KEY="${1:-${TIFUSI_NODE_API_KEY:-}}"
PORT="${2:-62050}"

# Asked before anything runs, so the rest of the install needs no attention.
if [ -z "$API_KEY" ]; then
  printf '\n'
  read -r -p "Node API key (from the panel's Nodes tab, after creating the node): " API_KEY
fi
[ -n "$API_KEY" ] || fail "Can't continue without an API key."

STEP_TOTAL=5

step "Docker"
if command -v docker >/dev/null 2>&1; then
  done_line "Docker is already installed"
else
  run_spinner "Installing Docker (official script)..." bash -c 'curl -fsSL https://get.docker.com | sh' || true
  command -v docker >/dev/null 2>&1 \
    || fail "Automatic Docker install failed — try it manually: curl -fsSL https://get.docker.com | sh"
fi

step "Node image"
# Prebuilt (by .github/workflows/build-images.yml) beats building locally —
# this Dockerfile compiles strongSwan from source for EAP-MSCHAPv2 support,
# which on a small single-vCPU VPS is several minutes of single-threaded
# compilation every single install. Falls back to a real local build (and
# the git clone it needs) if the pull fails — offline registry, a fork
# with no images published yet, or this repo's Packages not made Public.
PREBUILT_IMAGE="ghcr.io/javadtifusi-eng/tifusi-node-agent:latest"
if pull_with_progress "Downloading the node image..." "$PREBUILT_IMAGE"; then
  docker tag "$PREBUILT_IMAGE" tifusi-node-agent
else
  info "Prebuilt image unavailable — building locally instead. This compiles strongSwan from source and can take several minutes."
  run_spinner "Downloading source..." git clone --depth 1 "$REPO_URL" "$CLONE_DIR" || exit 1
  run_spinner "Building the node image (compiling strongSwan)..." \
    docker build -t tifusi-node-agent -f "$CLONE_DIR/backend/node_agent/Dockerfile" "$CLONE_DIR/backend" || exit 1
fi

step "Network tuning"
# BBR instead of cubic, with fq pacing and larger socket buffers. Links from
# Iran to a node abroad are long and lossy; cubic halves its rate on every
# lost packet, BBR paces to the bandwidth it measures, which is where most
# of the proxy's throughput is won or lost. Only new connections pick it
# up, so nothing already connected is interrupted.
modprobe tcp_bbr 2>/dev/null || true
if grep -qw bbr /proc/sys/net/ipv4/tcp_available_congestion_control 2>/dev/null; then
  echo tcp_bbr > /etc/modules-load.d/tifusi-bbr.conf 2>/dev/null || true
  cat > /etc/sysctl.d/99-tifusi-network.conf <<'SYSCTL'
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.core.rmem_max = 67108864
net.core.wmem_max = 67108864
net.ipv4.tcp_rmem = 4096 131072 67108864
net.ipv4.tcp_wmem = 4096 65536 67108864
net.core.netdev_max_backlog = 16384
net.ipv4.tcp_mtu_probing = 1
net.ipv4.tcp_mtu_probe_floor = 1024
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_notsent_lowat = 131072
SYSCTL
  # tcp_mtu_probe_floor: on a lossy mobile path (seen live on MCI) the
  # kernel takes throttling losses for an MTU black hole and shrinks the
  # MSS down to 128 bytes, which leaves the connection crawling; the path
  # really carries ~1400, so never probe below 1024.
  sysctl -q -p /etc/sysctl.d/99-tifusi-network.conf >/dev/null 2>&1 || true
  # default_qdisc only applies to interfaces set up after it changes.
  iface=$(ip -o route show default 2>/dev/null | awk '{print $5; exit}')
  [ -n "$iface" ] && tc qdisc replace dev "$iface" root fq 2>/dev/null || true
  done_line "BBR congestion control and larger network buffers"
else
  warn "This kernel has no BBR — keeping its default congestion control."
fi

step "L2TP / IKEv2 kernel support"
# l2tp_ppp/ppp_generic: xl2tpd needs these loaded into the HOST kernel to
# actually create L2TP/PPP sessions — a container can't load kernel
# modules into a kernel it doesn't own, so this has to happen out here,
# not inside the Dockerfile/container. `|| true` because a kernel that
# already has these built in (not as modules) has nothing to modprobe,
# and that's not a failure. ppp_generic is what actually owns /dev/ppp —
# confirmed live that a kernel can have l2tp_ppp loaded and still lack
# this, since it's what registers the character device, not l2tp_ppp.
modprobe l2tp_ppp 2>/dev/null || true
modprobe ppp_generic 2>/dev/null || true
# Some hosts' kernels create /dev/ppp via udev only, which a minimal VPS
# image may not be running — recreate it by hand (major/minor 108:0 is
# the kernel-assigned, unchanging device number for /dev/ppp) if loading
# the module alone didn't produce it.
[ -e /dev/ppp ] || mknod -m 600 /dev/ppp c 108 0 2>/dev/null || true
if [ -e /dev/ppp ]; then
  done_line "Loaded l2tp_ppp and ppp_generic"
else
  warn "No /dev/ppp on this kernel — Xray works, but an L2TP core on this node won't."
fi

step "Starting the node"
if docker ps -a --format '{{.Names}}' | grep -qx tifusi-node; then
  info "A container named tifusi-node already exists, replacing it..."
  docker rm -f tifusi-node >/dev/null
fi

# --network host, not -p per port: Xray binds to whatever proxy ports the
# panel's pushed config gives it, decided AFTER this container starts, and
# Docker can't pre-publish a port it doesn't know about yet. Host networking
# means every port Xray (or the agent) binds to is reachable directly,
# without having to predict and republish them one by one.
#
# NET_ADMIN/NET_RAW: only needed if the panel later assigns this node an
# l2tp/ikev2 Core — strongSwan/xl2tpd need them to touch IPsec kernel state
# and manage PPP interfaces. Harmless for a plain Xray node, so it's just
# always granted rather than making this script guess in advance.
EXTRA_DOCKER_ARGS=(--cap-add=NET_ADMIN --cap-add=NET_RAW)
# Every proxied connection holds two sockets in Xray; Docker's default limit
# of 1024 open files stalls a busy node once a few hundred are open.
EXTRA_DOCKER_ARGS+=(--ulimit nofile=1048576:1048576)
# Docker's default json-file driver never rotates: Xray's error log on a busy
# node grows until it fills the host's root filesystem, and a full disk is not
# just a dead node — sshd still accepts the connection but the session dies the
# moment PAM tries to write, locking the operator out of the server entirely.
# 10MB x 3 caps the node at 30MB. To reclaim space on a node installed before
# this: truncate -s 0 /var/lib/docker/containers/*/*-json.log
EXTRA_DOCKER_ARGS+=(--log-opt max-size=10m --log-opt max-file=3)
if [ -d /lib/modules ]; then
  EXTRA_DOCKER_ARGS+=(-v /lib/modules:/lib/modules:ro)
fi
# /dev/ppp: xl2tpd/pppd need this character device to create PPP
# interfaces at all — Docker doesn't pass host devices into a container
# by default, so without this xl2tpd fails even once the host kernel has
# every l2tp/ppp module loaded (confirmed live, this exact gap).
if [ -e /dev/ppp ]; then
  EXTRA_DOCKER_ARGS+=(--device=/dev/ppp:/dev/ppp)
fi

run_spinner "Starting the node agent..." \
  docker run -d --name tifusi-node --restart unless-stopped \
  --network host "${EXTRA_DOCKER_ARGS[@]}" \
  -e "TIFUSI_NODE_API_KEY=${API_KEY}" -e "AGENT_PORT=${PORT}" tifusi-node-agent || exit 1

# The agent generates its TLS certificate before listening, so give it a
# moment; a port that never opens usually means the container is crashing.
wait_for_agent() {
  local _
  for _ in $(seq 1 60); do
    ss -tlnH "( sport = :$PORT )" 2>/dev/null | grep -q . && return 0
    sleep 1
  done
  return 1
}
if ! run_spinner "Waiting for the agent on port $PORT..." wait_for_agent; then
  warn "The agent didn't start listening — check its logs: docker logs tifusi-node"
  exit 1
fi

step "Management command"
# The fast path pulls the prebuilt image and never clones, so fetch just the
# three files the command is made of instead of cloning the whole repo for them.
if [ ! -f "$CLONE_DIR/scripts/manage-node.sh" ]; then
  mkdir -p "$CLONE_DIR/scripts"
  for f in install-commands.sh manage-node.sh tifusi; do
    curl -fsSL "$RAW_BASE/scripts/$f" -o "$CLONE_DIR/scripts/$f" || break
  done
fi
if [ -f "$CLONE_DIR/scripts/install-commands.sh" ] && [ -f "$CLONE_DIR/scripts/manage-node.sh" ]; then
  # shellcheck source=scripts/install-commands.sh
  source "$CLONE_DIR/scripts/install-commands.sh"
  install_node_commands "$CLONE_DIR"
  done_line "Installed the 'tifusi node' command"
else
  warn "Couldn't install the 'tifusi node' command — to remove this node later: docker rm -f tifusi-node"
fi

print_block "Node Ready" "$C_GREEN" \
  "Agent port :  $PORT" \
  "Network    :  host" \
  "Manage     :  tifusi node  (status, logs, restart, uninstall)" \
  "Next step  :  press Sync on this node in the panel"
printf '\n%s%s%s Node is up.\n' "$C_GREEN" "$UI_OK" "$C_RESET"
