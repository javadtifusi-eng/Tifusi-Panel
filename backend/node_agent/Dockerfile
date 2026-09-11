FROM python:3.12-slim AS strongswan-builder

# Debian's packaged strongSwan doesn't ship eap-mschapv2 at all (confirmed
# live: dpkg -L libcharon-extra-plugins lists eap-md5/gtc/tls/ttls/aka but
# no eap-mschapv2, and apt-cache search turns up nothing either) — it needs
# MD4, which modern OpenSSL dropped, so distros just leave the plugin out.
# Native iOS/Windows IKEv2 "Username" auth specifically requires
# EAP-MSCHAPv2 (nothing else), so there's no packaged way to get a normal
# username/password prompt working — building strongSwan ourselves with
# --enable-eap-mschapv2 (which pulls in strongSwan's own MD4 plugin, not
# OpenSSL's) is the actual fix real-world guides for this same problem use.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config bison flex gettext \
      libgmp-dev libssl-dev \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pinned to 5.9.x, not the 6.x series: live testing found a 6.0.1-built
# charon's IKE_AUTH response (CERT+AUTH+EAP-Identity) gets silently dropped
# partway through negotiation on a network where an otherwise-identical
# 5.9.14 setup (same proposals, same send_cert=always/fragmentation=yes,
# same cert, same client) connects immediately — something about 6.x's
# wire-level construction of that message trips a filter 5.9.x doesn't.
ARG STRONGSWAN_VERSION=5.9.14
RUN curl -fsSL -o /tmp/strongswan.tar.bz2 \
      "https://download.strongswan.org/strongswan-${STRONGSWAN_VERSION}.tar.bz2" \
    && mkdir -p /tmp/strongswan-src \
    && tar -xjf /tmp/strongswan.tar.bz2 -C /tmp/strongswan-src --strip-components=1 \
    && cd /tmp/strongswan-src \
    && ./configure --prefix=/usr --sysconfdir=/etc \
         --enable-eap-mschapv2 --enable-eap-identity --enable-md4 \
         --enable-swanctl --enable-vici \
    && make -j"$(nproc)" \
    && make DESTDIR=/build install

FROM python:3.12-slim

# Runtime counterparts of the -dev libs the builder stage compiled
# against, plus xl2tpd/ppp/iptables for l2tp (only actually used when the
# panel assigns this node an l2tp or ikev2 Core — see node_agent/ipsec.py
# — installed unconditionally so a node never needs a second
# install/rebuild just to switch which kind of core it serves). iproute2
# is for the `ip rule`/`ip route` policy-routing table node_agent/vless_egress.py
# sets up when a node's l2tp/ikev2 is chained through another panel's VLESS.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl unzip ca-certificates \
      libgmp10 libssl3 \
      xl2tpd ppp iptables iproute2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=strongswan-builder /build/ /

# The real Xray-core binary. This is the one piece of the node agent that
# couldn't be verified inside the sandboxed session this project was built
# in — outbound GitHub access was blocked there — but it's a standard
# release download that works in any normal Docker build environment.
ARG XRAY_VERSION=v1.8.24
RUN curl -fsSL -o /tmp/xray.zip \
      "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-64.zip" \
    && unzip -o /tmp/xray.zip -d /usr/local/bin xray \
    && chmod +x /usr/local/bin/xray \
    && rm /tmp/xray.zip

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY node_agent ./node_agent

ENV XRAY_BIN=/usr/local/bin/xray
ENV XRAY_CONFIG_PATH=/app/data/xray-config.json
RUN mkdir -p /app/data

EXPOSE 62050

# node_agent/serve.py (not a bare `uvicorn node_agent.main:app` CLI call)
# so the self-signed TLS cert it serves on gets generated before uvicorn
# tries to load it — see node_agent/tls.py for why this agent speaks HTTPS
# at all. Exec form works fine here since serve.py reads $AGENT_PORT itself.
CMD ["python", "-m", "node_agent.serve"]
