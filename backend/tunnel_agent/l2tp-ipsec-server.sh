#!/usr/bin/env bash
# Installs and configures the actual L2TP/IPsec VPN server (strongSwan +
# xl2tpd) - the piece Tifusi Tunnel and l2tp-bridge.sh both assume already
# exists. Run this on the FOREIGN server (where the VPN service should
# live), not the Iran side.
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/backend/tunnel_agent/l2tp-ipsec-server.sh)
#
# After this, forward UDP 500/4500 (and, only for a phone/OS VPN client
# with no IPsec, UDP 1701) from the Iran side to this server with Tifusi
# Tunnel as usual - "bm" -> Add forwarded ports -> L2TP/IPsec.
set -uo pipefail

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
  else die "unsupported package manager - install strongswan + xl2tpd manually"; fi
}

gen_secret() { tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 20; }

require_root
info "installing strongSwan + xl2tpd"
pkg_install strongswan xl2tpd || die "package install failed"
command -v ipsec >/dev/null 2>&1 || die "strongSwan did not install correctly"

echo
psk=$(ask "IPsec pre-shared key (PSK) - leave empty to generate one" "")
[ -z "$psk" ] && psk=$(gen_secret)
vpn_user=$(ask "VPN username" "vpnuser")
vpn_pass=$(ask "VPN password - leave empty to generate one" "")
[ -z "$vpn_pass" ] && vpn_pass=$(gen_secret)

# best-effort default outgoing interface, for NAT/masquerade
iface=$(ip route show default 2>/dev/null | awk '/default/ {print $5; exit}')
[ -z "$iface" ] && iface=eth0
iface=$(ask "Outgoing network interface (for NAT)" "$iface")

info "writing /etc/ipsec.conf"
cat > /etc/ipsec.conf <<EOF
config setup
    charondebug="ike 1, knl 1, cfg 0"
    uniqueids=no

conn L2TP-PSK
    keyexchange=ikev1
    authby=secret
    left=%defaultroute
    leftprotoport=17/1701
    right=%any
    rightprotoport=17/%any
    type=transport
    auto=add
    ike=aes256-sha1-modp1024,aes128-sha1-modp1024,3des-sha1-modp1024!
    esp=aes256-sha1,aes128-sha1,3des-sha1!
    dpdaction=clear
    dpddelay=30
    dpdtimeout=120
EOF

info "writing /etc/ipsec.secrets"
umask 077
cat > /etc/ipsec.secrets <<EOF
%any %any : PSK "$psk"
EOF

info "writing /etc/xl2tpd/xl2tpd.conf"
mkdir -p /etc/xl2tpd
cat > /etc/xl2tpd/xl2tpd.conf <<EOF
[global]
port = 1701

[lns default]
ip range = 10.10.10.10-10.10.10.100
local ip = 10.10.10.1
require chap = yes
refuse pap = yes
require authentication = yes
name = tifusi-l2tp
ppp debug = no
pppoptfile = /etc/ppp/options.xl2tpd
length bit = yes
EOF

info "writing /etc/ppp/options.xl2tpd"
mkdir -p /etc/ppp
cat > /etc/ppp/options.xl2tpd <<EOF
require-mschap-v2
ms-dns 1.1.1.1
ms-dns 8.8.8.8
asyncmap 0
auth
crtscts
lock
hide-password
local
name tifusi-l2tp
proxyarp
lcp-echo-interval 30
lcp-echo-failure 4
EOF

info "writing /etc/ppp/chap-secrets"
umask 077
grep -q "^${vpn_user} " /etc/ppp/chap-secrets 2>/dev/null || \
  echo "${vpn_user} tifusi-l2tp ${vpn_pass} *" >> /etc/ppp/chap-secrets

info "enabling IP forwarding"
grep -q '^net.ipv4.ip_forward' /etc/sysctl.conf 2>/dev/null && \
  sed -i 's/^net.ipv4.ip_forward.*/net.ipv4.ip_forward=1/' /etc/sysctl.conf || \
  echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
sysctl -p >/dev/null 2>&1

info "NAT for VPN clients (via $iface)"
if ! iptables -t nat -C POSTROUTING -s 10.10.10.0/24 -o "$iface" -j MASQUERADE 2>/dev/null; then
  iptables -t nat -A POSTROUTING -s 10.10.10.0/24 -o "$iface" -j MASQUERADE
fi

info "starting services"
systemctl restart strongswan-starter 2>/dev/null || systemctl restart strongswan 2>/dev/null || systemctl restart ipsec 2>/dev/null
systemctl enable strongswan-starter 2>/dev/null || systemctl enable strongswan 2>/dev/null || systemctl enable ipsec 2>/dev/null
systemctl restart xl2tpd
systemctl enable xl2tpd >/dev/null 2>&1

sleep 1
if systemctl is-active --quiet xl2tpd; then ok "xl2tpd is running"; else warn "xl2tpd is not running - check: journalctl -u xl2tpd -n 30"; fi
if ipsec status >/dev/null 2>&1 || swanctl --list-conns >/dev/null 2>&1; then ok "IPsec is running"; else warn "IPsec may not be running - check: ipsec statusall"; fi

echo
ok "L2TP/IPsec server configured"
echo "  ${W}${BD}Enter these on the phone / VPN client:${N}"
echo "    Server   : ${W}<the Iran server's IP>${N}"
echo "    Account  : ${W}$vpn_user${N}"
echo "    Password : ${W}$vpn_pass${N}"
echo "    Secret   : ${W}$psk${N}"
echo
echo "  ${D}Make sure Tifusi Tunnel on the Iran side forwards UDP 500 and 4500${N}"
echo "  ${D}to this server (bm -> Add forwarded ports -> L2TP/IPsec -> yes IPsec).${N}"
