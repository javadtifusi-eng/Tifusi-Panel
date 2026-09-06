#!/bin/sh
# Runs automatically before nginx starts (nginx's official image executes
# every script under /docker-entrypoint.d/). If certs are mounted at
# /etc/nginx/certs (see docker-compose.yml), swap in the config that
# terminates TLS on 443 and redirects 80 -> 443; otherwise leave the
# default plain-HTTP config alone.
set -e

CERT_DIR=/etc/nginx/certs
if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
  cp /etc/nginx/nginx-ssl.conf.available /etc/nginx/conf.d/default.conf
fi
