FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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

# Shell form (not exec-form JSON) so $AGENT_PORT actually expands — this
# container runs with --network host (see install-node.sh), since Xray
# itself binds to whatever ports the panel's pushed config gives it, chosen
# per-host after the container already exists. Docker has no way to
# pre-publish ports it doesn't know about yet, so the container shares the
# host's real network stack instead of using -p per port.
CMD uvicorn node_agent.main:app --host 0.0.0.0 --port ${AGENT_PORT:-62050}
