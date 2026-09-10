#!/usr/bin/env bash
# Tifusi Tunnel installer / manager — now part of the Tifusi Panel repo
# (backend/tunnel_agent/), not a separate project.
#   bash <(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/backend/tunnel_agent/install.sh)
set -uo pipefail

REPO_USER="javadtifusi-eng"
REPO_NAME="Tifusi-Panel"
BRANCH="main"
TUNNEL_DIR="backend/tunnel_agent"
RAW="https://raw.githubusercontent.com/${REPO_USER}/${REPO_NAME}/${BRANCH}/${TUNNEL_DIR}"
RELEASE="https://github.com/${REPO_USER}/${REPO_NAME}/releases/latest/download"

BIN=/usr/local/bin/tifusi
MENU=/usr/local/bin/tifusi-menu
CFG_DIR=/etc/tifusi
CFG=$CFG_DIR/config.json
UNIT=/etc/systemd/system/tifusi.service
CRON=/etc/cron.d/tifusi
SRC_DIR=/opt/tifusi-src
GO_MIN=1.21

# palette: text is white, numbers are red, only "running" is green
W=$'\e[97m'; R=$'\e[91m'; G=$'\e[92m'; BL=$'\e[94m'; C=$'\e[96m'; D=$'\e[90m'; N=$'\e[0m'; BD=$'\e[1m'

# All four of these are status/log output for the user, never a value a
# caller should capture - printed to stderr so a caller that reads a
# result via "x=$(some_func)" (ask/ask_required in particular, which call
# warn() while re-prompting) can never have this text accidentally mixed
# into the captured value.
info() { echo "${W}==>${N} ${W}$*${N}" >&2; }
ok()   { echo "${G} ok ${N} ${W}$*${N}" >&2; }
warn() { echo "${R} !! ${N} ${W}$*${N}" >&2; }
die()  { echo "${R}fail${N} ${W}$*${N}" >&2; exit 1; }

cols() { local c; c=$(tput cols 2>/dev/null || echo 80); [ -n "$c" ] && echo "$c" || echo 80; }

# rule N repeats a single character N times without depending on seq.
rule() { local n="$1" ch="$2" out; printf -v out '%*s' "$n" ''; echo "${out// /$ch}"; }

banner() {
  clear 2>/dev/null || true
  local w; w=$(cols)
  echo
  if [ "$w" -ge 40 ]; then
    printf '%s%s' "$C" "$BD"
    cat <<'EOF'
 _____ ___ _____ _   _ ____ ___
|_   _|_ _|  ___| | | / ___|_ _|
  | |  | || |_  | | | \___ \| |
  | |  | ||  _| | |_| |___) | |
  |_| |___|_|    \___/|____/___|
EOF
    printf '%s%s' "$R" "$BD"
    cat <<'EOF'
 _____ _   _ _   _ _   _ _____ _
|_   _| | | | \ | | \ | | ____| |
  | | | | | |  \| |  \| |  _| | |
  | | | |_| | |\  | |\  | |___| |___
  |_|  \___/|_| \_|_| \_|_____|_____|
EOF
    printf '%s' "$N"
  else
    printf '  %s%sTIFUSI TUNNEL%s\n' "$C" "$BD" "$N"
  fi
  echo "  ${D}reverse tunnel · client-initiated${N}"
  echo
}

pause() { echo; read -r -p "  ${D}press Enter${N} " _; }

# step clears the screen and prints a consistent section header, so moving
# into a new step of the wizard doesn't leave the previous screen's menu
# still sitting above it - one header style (cyan, bold, "▸" marker) used
# everywhere instead of every function inventing its own.
step() {
  clear 2>/dev/null || true
  echo
  echo "  ${C}${BD}▸ $1${N}"
  [ -n "${2:-}" ] && echo "  ${D}$2${N}"
  echo "  ${D}$(rule 34 "─")${N}"
}

require_root() { [ "$(id -u)" = 0 ] || die "run this script as root (sudo -i)"; }

pkg_install() {
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
  elif command -v dnf >/dev/null 2>&1; then dnf install -y -q "$@"
  elif command -v yum >/dev/null 2>&1; then yum install -y -q "$@"
  elif command -v apk >/dev/null 2>&1; then apk add --no-cache "$@"
  else warn "unknown package manager, please install manually: $*"; fi
}

ensure_deps() {
  local need=()
  command -v curl >/dev/null 2>&1 || need+=(curl)
  command -v tar  >/dev/null 2>&1 || need+=(tar)
  command -v jq   >/dev/null 2>&1 || need+=(jq)
  if [ ${#need[@]} -gt 0 ]; then
    info "installing dependencies: ${need[*]}"
    pkg_install "${need[@]}"
  fi
  command -v jq >/dev/null 2>&1 || die "jq is required and could not be installed"
}

arch_tag() {
  case "$(uname -m)" in
    x86_64|amd64)  echo amd64 ;;
    aarch64|arm64) echo arm64 ;;
    armv7l)        echo armv6l ;;
    *) return 1 ;;
  esac
}

# ------------------------------------------------------------------ toolchain

have_go() {
  local g v
  g=$(command -v go 2>/dev/null); [ -z "$g" ] && g=/usr/local/go/bin/go
  [ -x "$g" ] || return 1
  v=$("$g" version 2>/dev/null | awk '{print $3}' | sed 's/^go//')
  [ -n "$v" ] || return 1
  [ "$(printf '%s\n%s\n' "$GO_MIN" "$v" | sort -V | head -1)" = "$GO_MIN" ]
}

persist_path() {
  grep -q '/usr/local/go/bin' /etc/profile 2>/dev/null || \
    echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/profile
}

ensure_go() {
  export PATH=$PATH:/usr/local/go/bin
  if have_go; then ok "using $(go version | awk '{print $3}')"; return; fi

  local ver a url
  ver=$(curl -fsSL --max-time 10 "https://go.dev/VERSION?m=text" 2>/dev/null | head -1 | tr -d '[:space:]')
  [ -z "$ver" ] && ver="go1.22.5"
  a=$(arch_tag) || die "unsupported architecture: $(uname -m)"

  for url in "https://go.dev/dl/${ver}.linux-${a}.tar.gz" \
             "https://dl.google.com/go/${ver}.linux-${a}.tar.gz"; do
    info "downloading $ver"
    if curl -fsSL --max-time 600 "$url" -o /tmp/go.tgz && [ -s /tmp/go.tgz ]; then
      rm -rf /usr/local/go && tar -C /usr/local -xzf /tmp/go.tgz && rm -f /tmp/go.tgz
      export PATH=$PATH:/usr/local/go/bin
      if have_go; then ok "go installed"; persist_path; return; fi
    fi
    rm -f /tmp/go.tgz
  done

  # Google's download hosts are blocked from many Iranian networks
  warn "the Go download servers are unreachable from this network"
  info "falling back to the distribution package"
  pkg_install golang-go >/dev/null 2>&1 || pkg_install golang >/dev/null 2>&1 || true
  export PATH=$PATH:/usr/local/go/bin
  if have_go; then ok "using $(go version | awk '{print $3}')"; return; fi

  die "no usable Go toolchain (need >= $GO_MIN). Build elsewhere with build.sh and
     upload dist/* to a GitHub release tagged \"latest\", then run option 1 again."
}

# ------------------------------------------------------------------ binary

bin_version() {
  [ -x "$BIN" ] || return 1
  local v; v=$("$BIN" -version 2>/dev/null | head -1)
  case "$v" in tifusi\ *) echo "$v" ;; *) return 1 ;; esac
}

stop_legacy() {
  bin_version >/dev/null 2>&1 && return
  [ -x "$BIN" ] || return
  warn "an older version (the iptables/bash version) is installed at $BIN"
  local units u
  units=$(systemctl list-units --all --plain --no-legend 2>/dev/null \
          | awk '{print $1}' | grep -E '^(bomalo|tifusi|tunnel)' | grep -v '^tifusi.service$')
  if [ -n "$units" ]; then
    for u in $units; do systemctl disable --now "$u" >/dev/null 2>&1; done
    echo "   ${D}stopped legacy services${N}"
  fi
  if iptables -t nat -S PREROUTING 2>/dev/null | grep -q 'DNAT'; then
    warn "old DNAT rules are still present:"
    iptables -t nat -S PREROUTING | grep DNAT | sed 's/^/     /'
    echo "   ${D}remove them one by one: iptables -t nat -D PREROUTING <n>${N}"
  fi
  cp -f "$BIN" "${BIN}.legacy.bak" 2>/dev/null
}

install_shortcut() {
  if [ -f ./install.sh ]; then
    install -m 0755 ./install.sh "$MENU" 2>/dev/null
  else
    curl -fsSL "$RAW/install.sh" -o "$MENU" 2>/dev/null && chmod 0755 "$MENU"
  fi
  [ -x "$MENU" ] || return 1
  ln -sf "$MENU" /usr/local/bin/bm
  return 0
}

install_binary() {
  step "Install / update the binary"
  stop_legacy
  local a; a=$(arch_tag) || die "unsupported architecture: $(uname -m)"
  info "looking for a prebuilt binary"
  if curl -fsSL "${RELEASE}/tifusi-linux-${a}" -o /tmp/tifusi 2>/dev/null && [ -s /tmp/tifusi ]; then
    install -m 0755 /tmp/tifusi "$BIN"; rm -f /tmp/tifusi
    ok "installed $(bin_version)"
  else
    warn "no release binary found, building from source"
    ensure_go
    mkdir -p "$SRC_DIR"
    if [ -f ./main.go ] && [ -f ./mux.go ] && [ -f ./panel.go ] && [ -f ./panel_ui.html ] \
       && [ -f ./go.mod ] && [ -f ./go.sum ]; then
      cp ./main.go ./mux.go ./panel.go ./panel_ui.html ./go.mod ./go.sum "$SRC_DIR/"
    else
      curl -fsSL "$RAW/main.go"       -o "$SRC_DIR/main.go"       || die "could not download main.go"
      curl -fsSL "$RAW/mux.go"        -o "$SRC_DIR/mux.go"        || die "could not download mux.go"
      curl -fsSL "$RAW/panel.go"      -o "$SRC_DIR/panel.go"      || die "could not download panel.go"
      curl -fsSL "$RAW/panel_ui.html" -o "$SRC_DIR/panel_ui.html" || die "could not download panel_ui.html"
      curl -fsSL "$RAW/go.mod"        -o "$SRC_DIR/go.mod"        || die "could not download go.mod"
      curl -fsSL "$RAW/go.sum"        -o "$SRC_DIR/go.sum"        || die "could not download go.sum"
    fi
    ( cd "$SRC_DIR" && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$BIN" . ) || die "build failed"
    chmod 0755 "$BIN"
    ok "built and installed $(bin_version)"
  fi
  install_shortcut && ok "type ${R}bm${N}${W} to open this menu again"
}

# ------------------------------------------------------------------ service

write_unit() {
  cat > "$UNIT" <<EOF
[Unit]
Description=Tifusi Tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$BIN -config $CFG
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
}

save_cfg() {
  mkdir -p "$CFG_DIR"
  echo "$1" | jq . > "$CFG" || die "could not write config"
  chmod 600 "$CFG"
}

restart_service() {
  write_unit
  systemctl enable tifusi >/dev/null 2>&1
  systemctl restart tifusi
  sleep 1
  if systemctl is-active --quiet tifusi; then ok "service is running"
  else warn "service failed - check the logs in Manage"; fi
}

open_port() {
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "$1/$2" >/dev/null 2>&1 && echo "   ${D}ufw: opened $1/$2${N}"
  elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port="$1/$2" >/dev/null 2>&1
    firewall-cmd --reload >/dev/null 2>&1 && echo "   ${D}firewalld: opened $1/$2${N}"
  fi
}

ask() {
  local p="$1" d="${2:-}" a
  if [ -n "$d" ]; then read -r -p "  ${W}$p${N} [$d]: " a; echo "${a:-$d}"
  else read -r -p "  ${W}$p${N}: " a; echo "$a"; fi
}

# ask_required is like ask() with no default - it re-prompts (with a
# warning) until something is actually typed, instead of letting an empty
# Enter silently fall back to a canned value.
ask_required() {
  local p="$1" a
  a=$(ask "$p" "")
  while [ -z "$a" ]; do
    warn "this can't be left empty"
    a=$(ask "$p" "")
  done
  echo "$a"
}

# pick_transport asks in two steps - first the transport FAMILY (tcp/tls/
# ws/wss/udp), then, only for families that actually have a multiplexed
# sibling (tcp, ws, wss - not tls or udp), whether to use it. This keeps
# unrelated transports (udp is not "in the same branch" as tcp) from being
# mixed into one flat numbered list.
pick_transport() {
  local fam
  {
    echo
    echo "  ${W}${BD}Transport family:${N}"
    echo "    ${R}1${N}) ${G}tcp${N}"
    echo "    ${R}2${N}) ${G}tls${N}"
    echo "    ${R}3${N}) ${G}ws${N}"
    echo "    ${R}4${N}) ${G}wss${N}"
    echo "    ${R}5${N}) ${G}udp${N}"
  } >&2
  local c; read -r -p "  ${W}choice${N} [1]: " c
  case "${c:-1}" in
    2) fam=tls ;; 3) fam=ws ;; 4) fam=wss ;; 5) fam=udp ;; *) fam=tcp ;;
  esac

  case "$fam" in
    tls|udp) echo "$fam"; return ;;
  esac

  {
    echo
    echo "  ${W}${BD}$fam variant:${N}"
    echo "    ${R}1${N}) ${G}$fam${N}      ${W}${BD}plain${N}"
    echo "    ${R}2${N}) ${G}${fam}mux${N}   ${W}${BD}multiplexed${N}"
  } >&2
  local v; read -r -p "  ${W}choice${N} [1]: " v
  case "$v" in
    2) echo "${fam}mux" ;;
    *) echo "$fam" ;;
  esac
}

# true (0) if $1 is a ws-family transport (ws/wss/wsmux/wssmux) - the only
# ones that speak real HTTP/WebSocket and can therefore sit behind a
# WebSocket-aware CDN.
is_ws_family() {
  case "$1" in ws|wss|wsmux|wssmux) return 0 ;; *) return 1 ;; esac
}

# true (0) if $1 is a transport that actually presents a TLS certificate
# (tls/wss/wssmux) - the only ones a real, Let's-Encrypt-issued cert
# (instead of the default self-signed one) applies to.
uses_tls() {
  case "$1" in tls|wss|wssmux) return 0 ;; *) return 1 ;; esac
}

# arvan_hint prints a short setup guide for fronting this server's tunnel
# port with ArvanCloud - an Iranian CDN that is itself whitelisted inside
# Iran, so traffic to it is far less likely to be blocked outright than
# traffic straight to this VPS's bare IP.
arvan_hint() {
  local myip; myip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo YOUR_IRAN_IP)
  echo
  echo "  ${C}${BD}ArvanCloud CDN${N}"
  echo "  ${D}arvancloud.ir - whitelisted inside Iran${N}"
  echo
  echo "   ${D}1.${N} Add your domain as a CDN zone on ArvanCloud"
  echo "   ${D}2.${N} DNS A record -> ${W}$myip${N}"
  echo "   ${D}3.${N} Enable ${W}WebSocket${N}, origin port = tunnel port"
  echo "   ${D}4.${N} Use that domain as the SNI below"
  echo
  echo "  ${D}Users then reach you via ArvanCloud, not your raw IP.${N}"
  echo
}

# ------------------------------------------------------------------ setup

setup_server() {
  step "Set up as IRAN side" "public entry point - owns the ports users connect to"
  local port token transport sni path cfg ip use_cdn="" domain=""
  port=$(ask "Tunnel port (the foreign server dials this)" 8443)
  token=$(ask "Shared token (leave empty to generate)" "")
  [ -z "$token" ] && token=$("$BIN" -gen-token)
  transport=$(pick_transport)
  if is_ws_family "$transport"; then
    read -r -p "  ${W}Sit this behind a CDN like ArvanCloud?${N} [y/N]: " use_cdn
    [[ "$use_cdn" =~ ^[Yy]$ ]] && arvan_hint
  fi
  if [[ "$use_cdn" =~ ^[Yy]$ ]]; then
    sni=$(ask_required "Your ArvanCloud domain (used as SNI - not a fake one)")
  elif uses_tls "$transport"; then
    read -r -p "  ${W}Do you have a domain pointing at this server?${N} [y/N]: " has_domain
    if [[ "$has_domain" =~ ^[Yy]$ ]]; then
      domain=$(ask_required "Domain (its DNS A record must point at this server's IP)")
      sni="$domain"
      echo "   ${D}A free, real certificate will be requested from Let's Encrypt for this${N}"
      echo "   ${D}domain automatically - needs port 80 reachable for validation. A real${N}"
      echo "   ${D}certificate holds up far better against active probing than a self-signed one.${N}"
    else
      sni=$(ask_required "SNI / hostname to disguise as (e.g. a real site's domain)")
    fi
  else
    sni=$(ask_required "SNI / hostname to disguise as (e.g. a real site's domain)")
  fi
  path=$(ask "HTTP path (ws/wss only)" "/tunnel")

  # Re-running this (e.g. to change transport/SNI) must not wipe out
  # forwards that were already added and may be serving live traffic -
  # carry over whatever the existing config already has.
  local existing_forwards="[]"
  [ -f "$CFG" ] && existing_forwards=$(jq -c '.forwards // []' "$CFG" 2>/dev/null || echo "[]")

  cfg=$(jq -n --arg l "0.0.0.0:$port" --arg t "$transport" --arg tok "$token" \
              --arg s "$sni" --arg p "$path" --arg dom "$domain" \
              --argjson fw "$existing_forwards" \
        '{mode:"server", listen:$l, transport:$t, token:$tok, sni:$s, path:$p,
          domain:(if $dom=="" then null else $dom end), forwards:$fw}
         | with_entries(select(.value != null))')
  save_cfg "$cfg"
  open_port "$port" tcp
  [ -n "$domain" ] && open_port 80 tcp
  ip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo YOUR_IRAN_IP)
  echo
  ok "server configured"
  echo
  echo "  ${W}${BD}Copy these values to the foreign server:${N}"
  echo "    server    : ${W}$ip:$port${N}"
  echo "    token     : ${W}$token${N}"
  echo "    transport : ${W}$transport${N}"
  echo "    sni       : ${W}$sni${N}"
  echo "    path      : ${W}$path${N}"
  echo
  read -r -p "  ${W}Add forwarded ports now?${N} [Y/n]: " a
  [[ "${a:-y}" =~ ^[Yy]?$ ]] && add_forward
  restart_service
}

setup_client() {
  step "Set up as FOREIGN side" "exit node - dials out to the Iran server, no inbound ports needed"
  local ip port token transport sni path pool cfg
  ip=$(ask "Iran server IP" "")
  [ -z "$ip" ] && { warn "IP is required"; return; }
  port=$(ask "Tunnel port" 8443)
  token=$(ask "Shared token (from the Iran server)" "")
  [ -z "$token" ] && { warn "token is required"; return; }
  transport=$(pick_transport)
  sni=$(ask_required "SNI (must match the Iran server, exactly)")
  path=$(ask "HTTP path (ws/wss only)" "/tunnel")
  pool=$(ask "Warm connections to keep open (plain transports) / physical mux links (tcpmux, wsmux, wssmux)" 8)

  cfg=$(jq -n --arg s "$ip:$port" --arg t "$transport" --arg tok "$token" \
              --arg sn "$sni" --arg p "$path" --argjson pool "$pool" \
        '{mode:"client", server:$s, transport:$t, token:$tok, sni:$sn, path:$p, pool:$pool, mux_con:$pool}')
  save_cfg "$cfg"
  ok "client configured"
  echo "  ${D}Ports are chosen on the Iran side; this machine only dials out.${N}"
  restart_service
}

# ------------------------------------------------------------------ forwards

add_entry() {
  local name="$1" proto="$2" port="$3" rport="${4:-$3}" tmp
  [ -z "$port" ] && { warn "port is required"; return; }
  if [ "$port" = 22 ] || [ "$port" = "$(jq -r '.listen // ""' "$CFG" | sed 's/.*://')" ]; then
    warn "refusing to forward port $port - it would break SSH or the tunnel itself"
    return
  fi
  tmp=$(jq --arg n "$name" --arg p "$proto" \
           --arg l "0.0.0.0:$port" --arg t "127.0.0.1:$rport" \
        '.forwards |= (map(select(.listen != $l or .net != $p)) + [{name:$n, listen:$l, net:$p, target:$t}])' "$CFG")
  echo "$tmp" | jq . > "$CFG"
  open_port "$port" "$proto"
  ok "$proto $port -> 127.0.0.1:$rport ($name)"
}

add_forward() {
  [ -f "$CFG" ] || { warn "no config yet, run option 2 first"; return; }
  [ "$(jq -r .mode "$CFG")" = "server" ] || { warn "forwards belong on the Iran server"; return; }
  step "Add forwarded ports" "Which service should this Iran server publish?"
  while true; do
    echo "    ${R}1${N}) ${W}OpenVPN${N}         UDP 1194"
    echo "    ${R}2${N}) ${W}OpenVPN${N}         TCP 1194"
    echo "    ${R}3${N}) ${W}L2TP/IPsec${N}      UDP 500, 4500"
    echo "    ${R}4${N}) ${W}IKEv2${N}           UDP 500, 4500"
    echo "    ${R}5${N}) ${W}WireGuard${N}       UDP 51820"
    echo "    ${R}6${N}) ${W}VLESS / Xray${N}    TCP 443"
    echo "    ${R}7${N}) ${W}vpn-ui panel${N}    TCP 8081"
    echo "    ${R}8${N}) ${W}Custom port${N}"
    echo "    ${R}0${N}) ${W}Done${N}"
    local c n p pr t; read -r -p "  ${W}choice:${N} " c
    case "$c" in
      1) add_entry "OpenVPN" udp 1194 ;;
      2) add_entry "OpenVPN" tcp 1194 ;;
      3) echo
         echo "   ${W}Is IPsec actually configured on the foreign server for this?${N}"
         echo "     ${R}1${N}) ${W}Yes${N}  ${D}strongSwan/IPsec is set up (standard, encrypted L2TP/IPsec)${N}"
         echo "     ${R}2${N}) ${W}No${N}   ${D}plain L2TP only, no encryption - forwards port 1701 directly${N}"
         echo "   ${D}Neither yet? Run l2tp-ipsec-server.sh on the FOREIGN server first:${N}"
         echo "   ${D}bash <(curl -fsSL $RAW/l2tp-ipsec-server.sh)${N}"
         local l2mode; read -r -p "  ${W}choice${N} [1]: " l2mode
         if [ "$l2mode" = "2" ]; then
           add_entry "L2TP" udp 1701
           warn "plain L2TP has no encryption of its own - fine to get connected, not for real security"
         else
           add_entry "L2TP-IKE" udp 500; add_entry "L2TP-NATT" udp 4500
           echo "   ${D}port 1701 is not forwarded on purpose - with IPsec enabled,${N}"
           echo "   ${D}L2TP data travels inside the ESP/NAT-T flow on port 4500 and${N}"
           echo "   ${D}is delivered locally by the kernel; forwarding 1701 directly${N}"
           echo "   ${D}bypasses IPsec and confuses the session.${N}"
           warn "this plain relay often fails to connect - IPsec needs a stable peer"
           echo "   ${D}identity that a per-session relay can't give it. Use${N} ${W}Manage > WireGuard bridge${N} ${D}instead${N}"
           echo "   ${D}for real kernel NAT and a working IPsec session.${N}"
         fi ;;
      4) add_entry "IKEv2" udp 500; add_entry "IKEv2-NATT" udp 4500
         warn "this plain relay often fails to connect - IPsec needs a stable peer"
         echo "   ${D}identity that a per-session relay can't give it. Use${N} ${W}Manage > WireGuard bridge${N} ${D}instead${N}"
         echo "   ${D}for real kernel NAT and a working IPsec session.${N}" ;;
      5) add_entry "WireGuard" udp 51820 ;;
      6) add_entry "VLESS" tcp 443 ;;
      7) add_entry "vpn-ui" tcp 8081 ;;
      8) n=$(ask "  name" "custom")
         pr=$(ask "  protocol (tcp/udp)" tcp)
         p=$(ask "  public port on THIS server" "")
         t=$(ask "  port on the FOREIGN server" "$p")
         add_entry "$n" "$pr" "$p" "$t" ;;
      0) break ;;
      *) warn "invalid choice" ;;
    esac
    echo
  done
  list_forwards
}

list_forwards() {
  [ -f "$CFG" ] || return
  echo
  echo "  ${W}${BD}Current forwards:${N}"
  jq -r '.forwards[]? | "    \(.net)\t\(.listen)\t->  \(.target)\t\(.name // "")"' "$CFG" | expand -t 12
  echo
}

del_forward() {
  [ -f "$CFG" ] || { warn "no config"; return; }
  step "Remove a forwarded port"
  list_forwards
  local l tmp; l=$(ask "listen address to remove (e.g. 0.0.0.0:1194)" "")
  [ -z "$l" ] && return
  tmp=$(jq --arg l "$l" '.forwards |= map(select(.listen != $l))' "$CFG")
  echo "$tmp" | jq . > "$CFG"
  ok "removed $l"
}

# ------------------------------------------------------------------ manage

set_field() {
  local tmp
  tmp=$(jq --arg k "$1" --arg v "$2" '.[$k]=$v' "$CFG") || { warn "edit failed"; return; }
  echo "$tmp" | jq . > "$CFG"
  ok "$1 = $2"
}

edit_settings() {
  [ -f "$CFG" ] || { warn "no configuration yet"; return; }
  local mode; mode=$(jq -r .mode "$CFG")
  while true; do
    step "Settings" "$mode"
    echo "    transport : ${G}$(jq -r .transport "$CFG")${N}"
    echo "    token     : ${W}$(jq -r .token "$CFG")${N}"
    echo "    sni       : ${W}$(jq -r .sni "$CFG")${N}"
    echo "    path      : ${W}$(jq -r .path "$CFG")${N}"
    if [ "$mode" = server ]; then
      echo "    listen    : ${W}$(jq -r .listen "$CFG")${N}"
      echo "    domain    : ${W}$(jq -r '.domain // "(none - self-signed cert)"' "$CFG")${N}"
    else
      echo "    server    : ${W}$(jq -r .server "$CFG")${N}"
      echo "    pool      : ${W}$(jq -r .pool "$CFG")${N}  ${D}(plain transports)${N}"
      echo "    mux_con   : ${W}$(jq -r '.mux_con // 8' "$CFG")${N}  ${D}(tcpmux/wsmux/wssmux)${N}"
    fi
    echo
    echo "   ${R}1${N}) ${W}transport${N}    ${G}tcp/tls/ws/wss/tcpmux/wsmux/wssmux${N}"
    echo "   ${R}2${N}) ${W}token${N}        ${D}shared secret - must match on both servers${N}"
    echo "   ${R}3${N}) ${W}SNI${N}          ${D}fake hostname for tls/ws/wss and their mux variants${N}"
    echo "   ${R}4${N}) ${W}path${N}         ${D}HTTP path for ws/wss and their mux variants${N}"
    if [ "$mode" = server ]; then
      echo "   ${R}5${N}) ${W}tunnel port${N}  ${D}what the foreign server dials${N}"
      echo "   ${R}8${N}) ${W}Domain${N}       ${D}real Let's Encrypt cert instead of self-signed (tls/wss/wssmux)${N}"
    else
      echo "   ${R}5${N}) ${W}Iran ip:port${N} ${D}where this client connects${N}"
      echo "   ${R}6${N}) ${W}pool / mux_con${N}  ${D}warm connections / physical mux links${N}"
    fi
    echo "   ${R}7${N}) ${W}Performance preset${N}  ${D}BBR + buffer tuning${N}"
    echo "   ${R}0${N}) ${W}back${N}"
    local c v tmp; read -r -p "  ${W}choice:${N} " c
    case "$c" in
      1) v=$(pick_transport); set_field transport "$v"; pause ;;
      2) v=$(ask "new token" ""); [ -n "$v" ] && set_field token "$v"; pause ;;
      3) v=$(ask_required "new SNI"); set_field sni "$v"; pause ;;
      4) v=$(ask "new path" "/tunnel"); set_field path "$v"; pause ;;
      5) if [ "$mode" = server ]; then
           v=$(ask "new tunnel port" 8443); set_field listen "0.0.0.0:$v"; open_port "$v" tcp
         else
           v=$(ask "Iran server ip:port" "$(jq -r .server "$CFG")"); set_field server "$v"
         fi
         pause ;;
      6) [ "$mode" = client ] || { warn "client only"; sleep 1; continue; }
         v=$(ask "warm connections / mux links" 8)
         tmp=$(jq --argjson p "$v" '.pool=$p | .mux_con=$p' "$CFG") && echo "$tmp" | jq . > "$CFG" && ok "pool = mux_con = $v"
         pause ;;
      7) performance; pause ;;
      8) [ "$mode" = server ] || { warn "server only"; sleep 1; continue; }
         v=$(ask "New domain (leave empty to go back to a self-signed cert)" "")
         if [ -n "$v" ]; then
           set_field sni "$v"; set_field domain "$v"; open_port 80 tcp
         else
           tmp=$(jq 'del(.domain)' "$CFG") && echo "$tmp" | jq . > "$CFG" && ok "domain cleared - back to self-signed"
         fi
         pause ;;
      0) break ;;
      *) warn "invalid choice"; sleep 1 ;;
    esac
  done
  echo
  warn "transport, token, SNI and path must match on BOTH servers"
  restart_service
}

show_status() {
  step "Status"
  systemctl status tifusi --no-pager -l 2>/dev/null | head -12
  echo
  if [ -f "$CFG" ]; then
    echo "  mode      : ${W}$(jq -r .mode "$CFG")${N}"
    echo "  transport : ${G}$(jq -r .transport "$CFG")${N}"
    echo "  token     : ${W}$(jq -r .token "$CFG")${N}"
    [ "$(jq -r .mode "$CFG")" = "server" ] && list_forwards
  else
    warn "no configuration at $CFG"
  fi
}

# test_connection checks the things that actually determine whether the
# tunnel is working, instead of just "is the process running": whether the
# tunnel port is bound (server) or reachable (client), and what the most
# recent connection-state log line says.
test_connection() {
  step "Test tunnel connection"
  [ -f "$CFG" ] || { warn "no configuration yet"; return; }

  if systemctl is-active --quiet tifusi; then
    ok "service is running"
  else
    warn "service is not running - nothing to test, check Manage > Status"
    return
  fi

  local mode transport last
  mode=$(jq -r .mode "$CFG")
  transport=$(jq -r .transport "$CFG")
  last=$(journalctl -u tifusi -n 300 --no-pager 2>/dev/null \
         | grep -E "client connected from|client .* disconnected|control link established|control link lost" \
         | tail -1)

  if [ "$mode" = server ]; then
    local port; port=$(jq -r '.listen' "$CFG" | sed 's/.*://')
    if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$port "; then
      ok "tunnel port $port is listening (tcp)"
    elif command -v ss >/dev/null 2>&1 && ss -lun 2>/dev/null | grep -q ":$port "; then
      ok "tunnel port $port is listening (udp)"
    else
      warn "tunnel port $port does not look like it's listening"
    fi
    case "$last" in
      *"client connected"*) ok "a foreign server is connected" ;;
      *"disconnected"*) warn "the last foreign server disconnected - waiting for it to reconnect" ;;
      *) warn "no foreign server has connected yet - check it's running with the same token/transport/SNI/path" ;;
    esac
  else
    local server="${transport}" ip port
    server=$(jq -r .server "$CFG")
    ip="${server%%:*}"; port="${server##*:}"
    if (exec 3<>"/dev/tcp/$ip/$port") 2>/dev/null; then
      ok "reachable: opened a TCP connection to $ip:$port"
      exec 3<&- 3>&- 2>/dev/null
    elif [ "$transport" = udp ]; then
      echo "   ${D}TCP probe skipped - transport is udp, that's expected${N}"
    else
      warn "could not open a TCP connection to $ip:$port - check the Iran server and its firewall"
    fi
    case "$last" in
      *"control link established"*) ok "control link is established with the Iran server" ;;
      *"control link lost"*) warn "control link was lost and is reconnecting" ;;
      *) warn "no confirmed control link yet - check the logs (Manage > Live logs)" ;;
    esac
  fi
  [ -n "$last" ] && echo "   ${D}last activity: $last${N}"
}

write_cron() {
  {
    echo "# Tifusi Tunnel watchdog"
    echo "PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin"
    echo "*/5 * * * * root systemctl is-active --quiet tifusi || systemctl restart tifusi"
    [ "$1" = 1 ] && echo "0 4 * * * root systemctl restart tifusi"
  } > "$CRON"
  chmod 0644 "$CRON"
  systemctl restart cron 2>/dev/null || systemctl restart crond 2>/dev/null || true
  ok "watchdog enabled"
}

WG_IF="wg0"
WG_DIR="/etc/wireguard"
WG_CFG="$WG_DIR/${WG_IF}.conf"
WG_PORT_DEFAULT=51900

ensure_wg() {
  command -v wg >/dev/null 2>&1 && return
  info "installing WireGuard"
  pkg_install wireguard-tools wireguard >/dev/null 2>&1 || pkg_install wireguard >/dev/null 2>&1
  command -v wg >/dev/null 2>&1 || die "could not install WireGuard - install it manually (wireguard-tools) and try again"
}

wg_own_key() {
  mkdir -p "$WG_DIR"; chmod 700 "$WG_DIR"
  if [ ! -f "$WG_DIR/privatekey" ]; then
    umask 077
    wg genkey | tee "$WG_DIR/privatekey" | wg pubkey > "$WG_DIR/publickey"
  fi
  cat "$WG_DIR/publickey"
}

wg_status() {
  echo
  if ip link show "$WG_IF" >/dev/null 2>&1; then
    ok "wg0 is up"
    wg show "$WG_IF" 2>/dev/null | sed 's/^/   /'
  else
    warn "wg0 is not up"
  fi
  echo
}

# setup_wg_bridge configures a private, server-to-server WireGuard link
# between Iran and the foreign server. This exists for protocols (L2TP/
# IPsec) whose peer identity depends on a stable, real IP - something the
# app-level relay above cannot give them, since it opens an independent
# connection per forwarded port. Over this bridge, Iran can instead use
# real kernel NAT (exactly like a home router forwarding a port), which
# keeps that identity consistent the way IPsec expects.
setup_wg_bridge() {
  step "WireGuard bridge" "a private server-to-server link, for protocols like L2TP/IPsec"
  ensure_wg
  local pub; pub=$(wg_own_key)
  echo "   ${R}1${N}) ${W}This is the IRAN side${N}"
  echo "   ${R}2${N}) ${W}This is the FOREIGN side${N}"
  echo "   ${R}0${N}) ${W}back${N}"
  local role; read -r -p "  ${W}choice:${N} " role
  case "$role" in
    0|"") return ;;
    1|2) ;;
    *) warn "invalid choice"; return ;;
  esac

  local my_ip peer_pub peer_ip peer_endpoint port
  port=$(ask "WireGuard port (must match on both servers)" "$WG_PORT_DEFAULT")
  echo
  echo "  ${W}Your public key:${N} $pub"
  echo "  ${D}Copy this, and the port above, to the other server.${N}"
  echo
  peer_pub=$(ask "Peer's public key" "")
  [ -z "$peer_pub" ] && { warn "public key is required"; return; }
  peer_endpoint=$(ask "Peer's public IP" "")
  [ -z "$peer_endpoint" ] && { warn "peer IP is required"; return; }

  if [ "$role" = 1 ]; then my_ip="10.200.0.1/30"; peer_ip="10.200.0.2/32"
  else my_ip="10.200.0.2/30"; peer_ip="10.200.0.1/32"; fi

  local postup="" postdown=""
  if [ "$role" = 1 ]; then
    read -r -p "  ${W}Route L2TP/IPsec (UDP 500,4500) through this bridge?${N} [Y/n]: " rl
    if [[ "${rl:-y}" =~ ^[Yy]?$ ]]; then
      # a FIXED-address SNAT, not MASQUERADE: this interface's address never
      # changes, and a fixed source keeps the peer identity IPsec expects
      # stable across the life of a session (see l2tp-bridge.sh for the
      # same rationale in the standalone version of this bridge).
      postup="PostUp = sysctl -w net.ipv4.ip_forward=1; iptables -t nat -A PREROUTING -p udp -m multiport --dports 500,4500 -j DNAT --to-destination 10.200.0.2; iptables -t nat -A POSTROUTING -o %i -p udp -m multiport --dports 500,4500 -j SNAT --to-source 10.200.0.1; iptables -A FORWARD -o %i -j ACCEPT; iptables -A FORWARD -i %i -j ACCEPT"
      postdown="PostDown = iptables -t nat -D PREROUTING -p udp -m multiport --dports 500,4500 -j DNAT --to-destination 10.200.0.2; iptables -t nat -D POSTROUTING -o %i -p udp -m multiport --dports 500,4500 -j SNAT --to-source 10.200.0.1; iptables -D FORWARD -o %i -j ACCEPT; iptables -D FORWARD -i %i -j ACCEPT"
      # this now conflicts with Tifusi's own relay for the same ports - drop those forwards
      if [ -f "$CFG" ] && [ "$(jq -r .mode "$CFG" 2>/dev/null)" = "server" ]; then
        local tmp; tmp=$(jq '.forwards |= map(select(.listen != "0.0.0.0:500" and .listen != "0.0.0.0:4500"))' "$CFG")
        echo "$tmp" | jq . > "$CFG"
        ok "removed the old relay-based L2TP forwards (500/4500 now go through WireGuard instead)"
      fi
      open_port "$port" udp
    fi
  else
    # rp_filter must be off from the very first packet, not just after
    # wg-quick's own PostUp runs (which only applies once the interface is
    # already up) - otherwise the kernel can silently drop the relayed
    # L2TP/IPsec packets arriving over wg0 before they ever reach xl2tpd/
    # strongSwan, even though a plain ping across the bridge works fine.
    postup="PostUp = sysctl -w net.ipv4.conf.all.rp_filter=0>/dev/null; sysctl -w net.ipv4.conf.%i.rp_filter=0>/dev/null"
    {
      grep -q '^net.ipv4.conf.all.rp_filter' /etc/sysctl.conf 2>/dev/null && \
        sed -i 's/^net.ipv4.conf.all.rp_filter.*/net.ipv4.conf.all.rp_filter=0/' /etc/sysctl.conf || \
        echo 'net.ipv4.conf.all.rp_filter=0' >> /etc/sysctl.conf
    }
    sysctl -p >/dev/null 2>&1
  fi

  cat > "$WG_CFG" <<EOF
[Interface]
PrivateKey = $(cat "$WG_DIR/privatekey")
Address = $my_ip
ListenPort = $port
$postup
$postdown

[Peer]
PublicKey = $peer_pub
AllowedIPs = $peer_ip
Endpoint = $peer_endpoint:$port
PersistentKeepalive = 25
EOF
  chmod 600 "$WG_CFG"
  open_port "$port" udp

  systemctl enable --now "wg-quick@${WG_IF}" >/dev/null 2>&1
  systemctl restart "wg-quick@${WG_IF}"
  sleep 1
  if ip link show "$WG_IF" >/dev/null 2>&1; then
    ok "bridge is up"
    echo "   ${D}test it once the other side is configured: ping $( [ "$role" = 1 ] && echo 10.200.0.2 || echo 10.200.0.1 )${N}"
    [ "$role" = 1 ] && restart_service
  else
    warn "wg0 did not come up - check: journalctl -u wg-quick@${WG_IF} -n 30"
  fi
}

watchdog() {
  command -v crontab >/dev/null 2>&1 || pkg_install cron >/dev/null 2>&1
  while true; do
    step "Watchdog / cron" "current: $( [ -f "$CRON" ] && echo enabled || echo disabled )"
    echo "   ${R}1${N}) ${W}check every 5 minutes, restart if the service is down${N}"
    echo "   ${R}2${N}) ${W}the same, plus a daily restart at 04:00${N}"
    echo "   ${R}3${N}) ${W}disable${N}"
    echo "   ${R}0${N}) ${W}back${N}"
    local c; read -r -p "  ${W}choice:${N} " c
    case "$c" in
      1) write_cron 0; pause ;;
      2) write_cron 1; pause ;;
      3) rm -f "$CRON"; ok "watchdog disabled"; pause ;;
      0) break ;;
      *) warn "invalid choice"; sleep 1 ;;
    esac
  done
}

apply_perf_preset() {
  local level="$1" rmem wmem
  case "$level" in
    1) rmem=4194304;  wmem=4194304  ;;   # Balance - light on RAM, small/shared VPS
    2) rmem=16777216; wmem=16777216 ;;   # Turbo - tuned default for Iran<->abroad links
    3) rmem=33554432; wmem=33554432 ;;   # Aggressive - max headroom, more RAM
    *) warn "invalid preset"; return ;;
  esac
  sed -i '/# Tifusi Tunnel performance preset/,/# end Tifusi Tunnel preset/d' /etc/sysctl.conf
  {
    echo "# Tifusi Tunnel performance preset"
    echo "net.core.default_qdisc=fq"
    echo "net.ipv4.tcp_congestion_control=bbr"
    echo "net.core.rmem_max=$rmem"
    echo "net.core.wmem_max=$wmem"
    echo "# end Tifusi Tunnel preset"
  } >> /etc/sysctl.conf
  sysctl -p >/dev/null 2>&1
  ok "applied - tcp_congestion_control is now $(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)"
}

performance() {
  step "Performance preset" "applies BBR congestion control + socket buffer sizing"
  echo "   ${R}1${N}) ${W}Balance${N}      ${D}light on RAM - small or shared VPS${N}"
  echo "   ${R}2${N}) ${W}Turbo${N}        ${D}recommended - tuned for Iran<->abroad links${N}"
  echo "   ${R}3${N}) ${W}Aggressive${N}   ${D}max throughput headroom - needs more RAM${N}"
  echo "   ${R}0${N}) ${W}back${N}"
  local c; read -r -p "  ${W}choice:${N} " c
  case "$c" in
    1|2|3) apply_perf_preset "$c" ;;
    0) return ;;
    *) warn "invalid choice" ;;
  esac
}

# setup_panel enables/reconfigures/disables the built-in HTTPS web admin
# panel (bilingual EN/FA UI, served by the tifusi binary itself). Exposed
# directly on the internet, protected by a username + bcrypt password hash
# (generated via "tifusi -panel-hash") - this is why it needs its own
# explicit opt-in rather than being on by default.
setup_panel() {
  step "Web panel" "browser-based admin UI over HTTPS"
  [ -f "$CFG" ] || { warn "no configuration yet - set up this server first"; return; }

  local ip; ip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo YOUR_SERVER_IP)
  local current; current=$(jq -r '.panel.enabled // false' "$CFG")
  if [ "$current" = "true" ]; then
    local listen user; listen=$(jq -r '.panel.listen' "$CFG"); user=$(jq -r '.panel.username' "$CFG")
    echo "   ${D}currently enabled:${N} ${W}https://$ip:${listen##*:}/${N}  ${D}(user: $user)${N}"
    echo
    echo "   ${R}1${N}) ${W}Change username / password${N}"
    echo "   ${R}2${N}) ${W}Disable${N}"
    echo "   ${R}0${N}) ${W}Back${N}"
    local c; read -r -p "  ${W}choice:${N} " c
    case "$c" in
      1) : ;; # fall through to (re)configure below
      2) local tmp; tmp=$(jq '.panel.enabled=false' "$CFG"); echo "$tmp" | jq . > "$CFG"
         ok "panel disabled"; restart_service; return ;;
      *) return ;;
    esac
  else
    read -r -p "  ${W}Enable the web panel?${N} [y/N]: " a
    [[ "$a" =~ ^[Yy]$ ]] || return
  fi

  local user pass port hash tmp
  user=$(ask_required "Panel username")
  while true; do
    read -r -s -p "  ${W}Panel password${N} (min 8 chars): " pass; echo
    [ "${#pass}" -ge 8 ] && break
    warn "must be at least 8 characters"
  done
  port=$(ask "Panel port" 9443)
  hash=$("$BIN" -panel-hash "$pass") || { warn "could not hash the password"; return; }

  tmp=$(jq --arg u "$user" --arg h "$hash" --arg l "0.0.0.0:$port" \
        '.panel = {enabled:true, listen:$l, username:$u, password_hash:$h}' "$CFG")
  echo "$tmp" | jq . > "$CFG"
  open_port "$port" tcp
  restart_service

  echo
  ok "panel enabled"
  echo "   ${W}URL${N} : ${W}${BD}https://$ip:$port/${N}"
  echo "   ${D}The certificate is self-signed, same as the tls transport - your${N}"
  echo "   ${D}browser will warn once; accept it to continue.${N}"
}

uninstall() {
  step "Uninstall Tifusi Tunnel"
  read -r -p "  ${W}Remove Tifusi Tunnel completely?${N} [y/N]: " a
  [[ "$a" =~ ^[Yy]$ ]] || return
  systemctl disable --now tifusi >/dev/null 2>&1
  systemctl disable --now "wg-quick@${WG_IF}" >/dev/null 2>&1
  rm -f "$UNIT" "$BIN" "$CRON" "$MENU" /usr/local/bin/bm "$WG_CFG"
  rm -rf "$CFG_DIR" "$SRC_DIR"
  systemctl daemon-reload
  ok "removed"
}

manage() {
  while true; do
    banner
    echo "  ${C}${BD}▸ Manage${N}"
    echo "  ${D}$(rule 34 "─")${N}"
    echo "   ${R}1${N}) ${W}Edit settings${N}   ${D}(transport, token, SNI, port)${N}"
    echo "   ${R}2${N}) ${W}Status${N}"
    echo "   ${R}3${N}) ${W}Live logs${N}"
    echo "   ${R}4${N}) ${W}Restart service${N}"
    echo "   ${R}5${N}) ${W}Watchdog / cron${N}"
    echo "   ${R}6${N}) ${W}WireGuard bridge${N}  ${D}(fixes L2TP/IPsec)${N}"
    echo "   ${R}7${N}) ${W}Web panel${N}         ${D}(browser admin UI)${N}"
    echo "   ${R}8${N}) ${W}Uninstall${N}"
    echo "   ${R}0${N}) ${W}Back${N}"
    echo
    local c; read -r -p "  ${W}choice:${N} " c
    case "$c" in
      1) edit_settings; pause ;;
      2) show_status; pause ;;
      3) step "Live logs" "Ctrl+C to go back"; journalctl -u tifusi -f -n 50 ;;
      4) step "Restart service"; restart_service; pause ;;
      5) watchdog ;;
      6) setup_wg_bridge; wg_status; pause ;;
      7) setup_panel; pause ;;
      8) uninstall; pause ;;
      0) break ;;
      *) warn "invalid choice"; sleep 1 ;;
    esac
  done
}

# ------------------------------------------------------------------ main menu

menu() {
  while true; do
    banner
    local ver st mode
    ver=$(bin_version 2>/dev/null) || ver="not installed"
    if systemctl is-active --quiet tifusi 2>/dev/null; then st="${G}running${N}"
    elif [ -f "$CFG" ]; then st="${W}stopped${N}"
    else st="${W}not configured${N}"; fi
    mode=""
    [ -f "$CFG" ] && mode="   ${D}mode:${N} ${W}$(jq -r .mode "$CFG")${N}"
    echo "  ${W}$ver${N}   ${D}service:${N} $st$mode"
    echo "  ${D}$(rule 34 "─")${N}"
    echo "   ${R}${BD}1${N}) ${W}${BD}Install / update the binary${N}"
    echo "   ${R}${BD}2${N}) ${W}${BD}Set up as IRAN side${N}      ${D}(server)${N}"
    echo "   ${R}${BD}3${N}) ${W}${BD}Set up as FOREIGN side${N}   ${D}(client)${N}"
    echo "   ${R}${BD}4${N}) ${W}${BD}Add forwarded ports${N}      ${D}(Iran)${N}"
    echo "   ${R}${BD}5${N}) ${W}${BD}Remove a forwarded port${N}  ${D}(Iran)${N}"
    echo "   ${R}${BD}6${N}) ${W}${BD}Test tunnel connection${N}"
    echo "   ${R}${BD}7${N}) ${W}${BD}Restart service${N}"
    echo "   ${R}${BD}8${N}) ${W}${BD}Manage${N}"
    echo "   ${R}${BD}9${N}) ${W}${BD}Uninstall${N}"
    echo "   ${R}${BD}0${N}) ${W}${BD}Exit${N}"
    echo
    local c; read -r -p "  ${W}choice:${N} " c
    case "$c" in
      1) install_binary; pause ;;
      2) [ -x "$BIN" ] || install_binary; setup_server; pause ;;
      3) [ -x "$BIN" ] || install_binary; setup_client; pause ;;
      4) add_forward; restart_service; pause ;;
      5) del_forward; restart_service; pause ;;
      6) test_connection; pause ;;
      7) step "Restart service"; restart_service; pause ;;
      8) manage ;;
      9) uninstall; pause ;;
      0) clear 2>/dev/null; exit 0 ;;
      *) warn "invalid choice"; sleep 1 ;;
    esac
  done
}

# ------------------------------------------------------------- unattended

# unattended_install installs and starts the tunnel with zero prompts, from
# a config.json already fully decided elsewhere (the panel) - the admin
# pastes ONE command per server and never sees this script's interactive
# menu at all. Contrast with the normal path (menu -> setup_server/
# setup_client), which asks for every field one at a time.
unattended_install() {
  local b64="$1" cfg mode port proto
  cfg=$(printf '%s' "$b64" | base64 -d 2>/dev/null) || die "invalid config (not valid base64)"
  echo "$cfg" | jq -e . >/dev/null 2>&1 || die "invalid config (not valid JSON)"

  install_binary
  save_cfg "$cfg"

  mode=$(echo "$cfg" | jq -r '.mode')
  if [ "$mode" = "server" ]; then
    port=$(echo "$cfg" | jq -r '.listen' | sed 's/.*://')
    open_port "$port" tcp
    [ "$(echo "$cfg" | jq -r '.domain // empty')" != "" ] && open_port 80 tcp
    while read -r port proto; do
      [ -n "$port" ] && open_port "$port" "$proto"
    done < <(echo "$cfg" | jq -r '.forwards[]? | (.listen | split(":")[1]) + " " + .net')
  fi

  restart_service
  echo
  ok "Tifusi Tunnel installed and running (mode: $mode)"
  echo "   ${D}manage it later with:${N} ${W}bm${N}"
}

require_root
ensure_deps

# `bash <(curl ...) -- <base64-config>` (same convention as install-node.sh)
# skips the interactive menu entirely and installs unattended from that one
# argument - this is what the panel's per-server install commands use.
if [ -n "${1:-}" ]; then
  unattended_install "$1"
  exit 0
fi

install_shortcut >/dev/null 2>&1
menu
