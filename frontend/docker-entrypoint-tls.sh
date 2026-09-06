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

(
  state=""
  has_cert && state=1 || state=0
  while true; do
    sleep 15
    next=""
    has_cert && next=1 || next=0
    if [ "$next" != "$state" ]; then
      apply_conf
      nginx -s reload 2>/dev/null || true
      state="$next"
    fi
  done
) &
