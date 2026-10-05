#!/usr/bin/env bash
# L2TP-over-WireGuard bridge — standalone, separate from Tifusi Tunnel.
#
# Problem this solves: L2TP/IPsec's peer identity must stay consistent
# across ports (500, 4500) and across the life of a session. An app-level
# relay that dials 127.0.0.1 per forwarded port breaks that. This script
# instead builds a real WireGuard link between the Iran server and the
# foreign server, then uses plain kernel NAT (DNAT + a FIXED-address SNAT,
# not MASQUERADE) on the Iran side — exactly how a home router forwards
# L2TP/IPsec to a LAN host, which is a well-understood, working scenario.
#
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/backend/tunnel_agent/l2tp-bridge.sh)
#
set -uo pipefail

WG_IF="wgl2tp"
WG_DIR="/etc/wireguard"
WG_CFG="$WG_DIR/${WG_IF}.conf"
WG_PORT_DEFAULT=51900
IRAN_IP="10.250.0.1"
FOREIGN_IP="10.250.0.2"
MARK="# l2tp-bridge managed"

R=$'\e[91m'; G=$'\e[92m'; W=$'\e[97m'; D=$'\e[90m'; N=$'\e[0m'; BD=$'\e[1m'
info() { echo "${W}==>${N} $*"; }
ok()   { echo "${G} ok ${N} $*"; }
warn() { echo "${R} !! ${N} $*"; }
die()  { echo "${R}fail${N} $*"; exit 1; }
ask()  { local p="$1" d="${2:-}" a; if [ -n "$d" ]; then read -r -p "$p [$d]: " a; echo "${a:-$d}"; else read -r -p "$p: " a; echo "$a"; fi; }

require_root() { [ "$(id -u)" = 0 ] || die "run as root (sudo -i)"; }

pkg_install() {
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
  elif command -v dnf >/dev/null 2>&1; then dnf install -y -q "$@"
  elif command -v yum >/dev/null 2>&1; then yum install -y -q "$@"
  elif command -v apk >/dev/null 2>&1; then apk add --no-cache "$@"
  else warn "unknown package manager - install manually: $*"; fi
}

ensure_wg() {
  command -v wg >/dev/null 2>&1 && return
  info "installing WireGuard"
  pkg_install wireguard-tools wireguard >/dev/null 2>&1 || pkg_install wireguard >/dev/null 2>&1
  command -v wg >/dev/null 2>&1 || die "could not install WireGuard"
}

own_key() {
  mkdir -p "$WG_DIR"; chmod 700 "$WG_DIR"
  if [ ! -f "$WG_DIR/${WG_IF}-private" ]; then
    umask 077
    wg genkey | tee "$WG_DIR/${WG_IF}-private" | wg pubkey > "$WG_DIR/${WG_IF}-public"
  fi
  cat "$WG_DIR/${WG_IF}-public"
}

# --------------------------------------------------------------- iran side

setup_iran() {
  ensure_wg
  local pub port peer_pub peer_ip
  pub=$(own_key)
  port=$(ask "WireGuard port (must match both servers)" "$WG_PORT_DEFAULT")
  echo
  echo "  ${W}Your public key:${N} $pub"
  echo "  ${D}Copy this and the port to the foreign server.${N}"
  echo
  peer_pub=$(ask "Foreign server's public key" "")
  [ -z "$peer_pub" ] && die "public key is required"
  peer_ip=$(ask "Foreign server's public IP" "")
  [ -z "$peer_ip" ] && die "foreign IP is required"

  cat > "$WG_CFG" <<EOF
$MARK
[Interface]
PrivateKey = $(cat "$WG_DIR/${WG_IF}-private")
Address = ${IRAN_IP}/30
ListenPort = $port
MTU = 1360
PostUp = sysctl -w net.ipv4.ip_forward=1>/dev/null; iptables -t nat -A PREROUTING -p udp -m multiport --dports 500,4500 -j DNAT --to-destination ${FOREIGN_IP}; iptables -t nat -A POSTROUTING -o %i -p udp -m multiport --dports 500,4500 -j SNAT --to-source ${IRAN_IP}; iptables -A FORWARD -o %i -j ACCEPT; iptables -A FORWARD -i %i -j ACCEPT
PostDown = iptables -t nat -D PREROUTING -p udp -m multiport --dports 500,4500 -j DNAT --to-destination ${FOREIGN_IP} 2>/dev/null || true; iptables -t nat -D POSTROUTING -o %i -p udp -m multiport --dports 500,4500 -j SNAT --to-source ${IRAN_IP} 2>/dev/null || true; iptables -D FORWARD -o %i -j ACCEPT 2>/dev/null || true; iptables -D FORWARD -i %i -j ACCEPT 2>/dev/null || true

[Peer]
PublicKey = $peer_pub
AllowedIPs = ${FOREIGN_IP}/32
Endpoint = $peer_ip:$port
PersistentKeepalive = 25
EOF
  chmod 600 "$WG_CFG"
  open_port "$port"
  bring_up
  warn "on the Iran server, make sure Tifusi itself is NOT also forwarding UDP 500/4500 -"
  echo "   ${D}(bm -> Add forwarded ports / Remove a forwarded port) - both would fight over the same ports.${N}"
}

# ------------------------------------------------------------- foreign side

setup_foreign() {
  ensure_wg
  local pub port peer_pub peer_ip
  pub=$(own_key)
  port=$(ask "WireGuard port (must match both servers)" "$WG_PORT_DEFAULT")
  echo
  echo "  ${W}Your public key:${N} $pub"
  echo "  ${D}Copy this and the port to the Iran server.${N}"
  echo
  peer_pub=$(ask "Iran server's public key" "")
  [ -z "$peer_pub" ] && die "public key is required"
  peer_ip=$(ask "Iran server's public IP" "")
  [ -z "$peer_ip" ] && die "Iran IP is required"

  cat > "$WG_CFG" <<EOF
$MARK
[Interface]
PrivateKey = $(cat "$WG_DIR/${WG_IF}-private")
Address = ${FOREIGN_IP}/30
ListenPort = $port
MTU = 1360
PostUp = sysctl -w net.ipv4.conf.all.rp_filter=0>/dev/null; sysctl -w net.ipv4.conf.%i.rp_filter=0>/dev/null
PostDown =

[Peer]
PublicKey = $peer_pub
AllowedIPs = ${IRAN_IP}/32
Endpoint = $peer_ip:$port
PersistentKeepalive = 25
EOF
  chmod 600 "$WG_CFG"
  open_port "$port"

  # rp_filter must be off from the very first packet, not just after wg-quick's
  # own PostUp runs (which only applies to the interface once it's already up)
  {
    grep -q '^net.ipv4.conf.all.rp_filter' /etc/sysctl.conf 2>/dev/null && \
      sed -i 's/^net.ipv4.conf.all.rp_filter.*/net.ipv4.conf.all.rp_filter=0/' /etc/sysctl.conf || \
      echo 'net.ipv4.conf.all.rp_filter=0' >> /etc/sysctl.conf
  }
  sysctl -p >/dev/null 2>&1

  bring_up
  ok "the L2TP/IPsec service itself (xl2tpd/strongSwan) needs no changes -"
  echo "   ${D}it just needs to be reachable at 127.0.0.1 or 0.0.0.0 on 500/4500, as usual.${N}"
}

# --------------------------------------------------------------- shared

open_port() {
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "$1/udp" >/dev/null 2>&1 && echo "   ${D}ufw: opened $1/udp${N}"
  elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port="$1/udp" >/dev/null 2>&1
    firewall-cmd --reload >/dev/null 2>&1 && echo "   ${D}firewalld: opened $1/udp${N}"
  fi
}

bring_up() {
  systemctl enable --now "wg-quick@${WG_IF}" >/dev/null 2>&1
  systemctl restart "wg-quick@${WG_IF}"
  sleep 1
  if ip link show "$WG_IF" >/dev/null 2>&1; then
    ok "bridge is up (interface $WG_IF)"
  else
    warn "bridge did not come up - check: journalctl -u wg-quick@${WG_IF} -n 40"
  fi
}

status() {
  echo
  if ip link show "$WG_IF" >/dev/null 2>&1; then
    ok "$WG_IF is up"
    wg show "$WG_IF" 2>/dev/null | sed 's/^/   /'
  else
    warn "$WG_IF is not up"
  fi
  echo
  echo "  ${W}iptables (only rules from this bridge):${N}"
  iptables -t nat -S PREROUTING  2>/dev/null | grep -F "$FOREIGN_IP" | sed 's/^/   nat PREROUTING:  /'
  iptables -t nat -S POSTROUTING 2>/dev/null | grep -F "$IRAN_IP"    | sed 's/^/   nat POSTROUTING: /'
  iptables -S FORWARD 2>/dev/null | grep -F "$WG_IF" | sed 's/^/   FORWARD:         /'
  echo
  echo "  ${D}sanity check once both sides are up: ping ${FOREIGN_IP} (from Iran) or ping ${IRAN_IP} (from foreign)${N}"
  echo
}

teardown() {
  read -r -p "  ${W}Remove the L2TP bridge completely?${N} [y/N]: " a
  [[ "$a" =~ ^[Yy]$ ]] || return
  systemctl disable --now "wg-quick@${WG_IF}" >/dev/null 2>&1
  rm -f "$WG_CFG" "$WG_DIR/${WG_IF}-private" "$WG_DIR/${WG_IF}-public"
  ok "removed"
}

menu() {
  echo
  echo "  ${W}${BD}L2TP-over-WireGuard bridge${N}  ${D}standalone, separate from the Tifusi installer${N}"
  echo "   ${R}1${N}) ${W}Set up - this is the IRAN side${N}"
  echo "   ${R}2${N}) ${W}Set up - this is the FOREIGN side${N}"
  echo "   ${R}3${N}) ${W}Status${N}"
  echo "   ${R}4${N}) ${W}Remove${N}"
  echo "   ${R}0${N}) ${W}Exit${N}"
  local c; read -r -p "  choice: " c
  case "$c" in
    1) setup_iran ;;
    2) setup_foreign ;;
    3) status ;;
    4) teardown ;;
    0) exit 0 ;;
    *) warn "invalid choice" ;;
  esac
}

require_root
menu
