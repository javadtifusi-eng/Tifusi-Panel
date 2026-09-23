#!/bin/sh
# Runs automatically before nginx starts (nginx's official image executes
# every script under /docker-entrypoint.d/). Picks the plain-HTTP or
# TLS-on-443 config depending on whether a cert/key is mounted at
# /etc/nginx/certs, then keeps watching in the background so a cert
# uploaded later from the panel's Settings page (or removed) takes effect
# with an `nginx -s reload` instead of needing a container restart.
set -e

CERT_DIR=/etc/nginx/certs
CONF=/etc/nginx/conf.d/default.conf
SSL_CONF=/etc/nginx/nginx-ssl.conf.available
HTTP_CONF=/etc/nginx/nginx-http.conf.available

has_cert() {
  [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]
}

apply_conf() {
  if has_cert; then
    cp "$SSL_CONF" "$CONF"
  else
    cp "$HTTP_CONF" "$CONF"
  fi
}

apply_conf

# "0" without a cert, otherwise the files' modification times — so a cert
# replaced in place (the panel renews Let's Encrypt on its own) reloads nginx
# too, not only one that appears or disappears.
cert_state() {
  if has_cert; then
    stat -c %Y "$CERT_DIR/fullchain.pem" "$CERT_DIR/privkey.pem" | tr '\n' ' '
    # Backup domains' server blocks (and the certificates they point at).
    find "$CERT_DIR/sni" -type f -name '*.pem' -o -type f -name 'servers*.conf' 2>/dev/null \
      | sort | xargs -r stat -c '%n%Y' 2>/dev/null | md5sum | cut -c1-12
  else
    echo 0
  fi
}

(
  state="$(cert_state)"
  while true; do
    sleep 15
    next="$(cert_state)"
    if [ "$next" != "$state" ]; then
      apply_conf
      nginx -s reload 2>/dev/null || true
      state="$next"
    fi
  done
) &
