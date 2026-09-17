#!/usr/bin/env bash
# Tifusi node management CLI — installed as `tifusi-node` by install-node.sh
# and run as `tifusi node`. The panel has manage.sh; this is its counterpart
# for a node server, where removing the agent previously meant knowing the
# right docker commands by heart.
#
# A node keeps no files on disk — the agent's port and API key live in the
# container's own environment — so everything here is read back off the
# container rather than from an install directory.

set -euo pipefail

CONTAINER=tifusi-node
IMAGE_LOCAL=tifusi-node-agent
IMAGE_REMOTE=ghcr.io/javadtifusi-eng/tifusi-node-agent:latest

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[1;31m'; C_GREEN=$'\033[1;32m'; C_YELLOW=$'\033[1;33m'
  C_CYAN=$'\033[1;36m'; C_GRAY=$'\033[0;90m'; C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""; C_GRAY=""; C_RESET=""; C_BOLD=""
fi

info() { printf '%s[Tifusi]%s %s\n' "$C_CYAN" "$C_RESET" "$1"; }
warn() { printf '%s[Warning]%s %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
err()  { printf '%s[Error]%s %s\n' "$C_RED" "$C_RESET" "$1"; }

command -v docker >/dev/null 2>&1 || { err "Docker isn't installed on this server."; exit 1; }

container_exists() { docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; }

# AGENT_PORT as the installer passed it; blank if the container is gone.
agent_port() {
  docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | sed -n 's/^AGENT_PORT=//p' | head -1
}

banner() {
  printf '\n%s _______ _____ ______ _    _  _____ _____\n' "$C_RED"
  printf '|__   __|_   _|  ____| |  | |/ ____|_   _|\n'
  printf '   | |    | | | |__  | |  | | (___   | |\n'
  printf '   | |    | | |  __| | |  | |\\___ \\  | |\n'
  printf '   | |   _| |_| |    | |__| |____) |_| |_\n'
  printf '   |_|  |_____|_|     \\____/|_____/|_____|%s\n\n' "$C_RESET"
  printf '%s%s  Tifusi Node  %s\n' "$C_BOLD" "$C_RED" "$C_RESET"
  printf '%s  GitHub: https://github.com/javadtifusi-eng/Tifusi-Panel%s\n' "$C_GRAY" "$C_RESET"
}

action_status() {
  if ! container_exists; then
    err "No node agent is installed on this server."
    return
  fi
  docker ps -a --filter "name=^/${CONTAINER}$" \
    --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
  echo
  local port
  port="$(agent_port)"
  port="${port:-62050}"
  if ss -tlnH "( sport = :$port )" 2>/dev/null | grep -q .; then
    printf '%sAgent:%s listening on port %s\n' "$C_GREEN" "$C_RESET" "$port"
  else
    printf '%sAgent:%s not listening on port %s\n' "$C_RED" "$C_RESET" "$port"
  fi
}

action_logs() {
  container_exists || { err "No node agent is installed on this server."; return; }
  info "Showing live logs (Ctrl+C to return to the menu)..."
  docker logs -f --tail=100 "$CONTAINER" || true
}

action_restart() {
  container_exists || { err "No node agent is installed on this server."; return; }
  info "Restarting the node agent..."
  docker restart "$CONTAINER" >/dev/null
  info "Restarted."
}

action_uninstall() {
  warn "This stops and removes the node agent, its image, and the 'tifusi node' command."
  warn "Remove the node from the panel's Nodes page too — the panel will keep trying to reach it otherwise."
  read -r -p "Type the word DELETE to continue: " confirm
  [ "$confirm" = "DELETE" ] || { info "Cancelled."; return; }

  if container_exists; then
    docker rm -f "$CONTAINER" >/dev/null
    info "Removed the $CONTAINER container."
  fi
  # Both tags point at one image; untagging each is what actually frees it.
  docker image rm "$IMAGE_LOCAL" "$IMAGE_REMOTE" >/dev/null 2>&1 || true

  rm -f /usr/local/bin/tifusi-node
  # The launcher is shared with the panel and the bot, so it only goes when
  # this was the last component left on the server.
  if [ ! -e /usr/local/bin/tifusi-panel ] && [ ! -e /usr/local/bin/tifusi-bot ]; then
    rm -f /usr/local/bin/tifusi
  fi
  info "Tifusi node uninstalled."
  exit 0
}

menu() {
  banner
  printf '\n%s  What would you like to do?%s\n\n' "$C_CYAN" "$C_RESET"
  printf '  %s1)%s Show node status\n' "$C_GREEN" "$C_RESET"
  printf '  %s2)%s View live logs\n' "$C_GREEN" "$C_RESET"
  printf '  %s3)%s Restart the node agent\n' "$C_GREEN" "$C_RESET"
  printf '  %s4)%s Uninstall the node completely\n' "$C_GREEN" "$C_RESET"
  printf '  %s0)%s Exit\n\n' "$C_GRAY" "$C_RESET"
  read -r -p "$(printf '%sEnter your choice: %s' "$C_GREEN" "$C_RESET")" choice
  echo
  case "$choice" in
    1) action_status ;;
    2) action_logs ;;
    3) action_restart ;;
    4) action_uninstall ;;
    0) exit 0 ;;
    *) warn "Invalid choice." ;;
  esac
}

# A single argument runs one action non-interactively (`tifusi node status`,
# `tifusi node uninstall`, ...) for scripting; no args drops into the menu loop.
case "${1:-}" in
  status) action_status ;;
  logs) action_logs ;;
  restart) action_restart ;;
  uninstall) action_uninstall ;;
  "")
    while true; do
      menu
      echo
      read -r -p "Press Enter to return to the menu..." _
      clear 2>/dev/null || true
    done
    ;;
  *)
    err "Unknown action: $1"
    err "Run 'tifusi node' with no arguments for the interactive menu."
    exit 1
    ;;
esac
