# Installs the `tifusi-panel` / `tifusi-node` commands and the shared `tifusi`
# launcher (scripts/tifusi). Sourced by install.sh and manage.sh from the
# install directory, and by install-node.sh from its clone.

# Copy then rename, so a tifusi-panel that is currently running is never overwritten mid-read.
place_command() {
  cp "$1" "$2.tmp.$$" && chmod 755 "$2.tmp.$$" && mv -f "$2.tmp.$$" "$2"
}

install_panel_commands() {
  local bin=/usr/local/bin
  # Before the launcher, Tifusi Bot kept its menu at `tifusi`; move it so `tifusi bot` still finds it.
  if [ -f "$bin/tifusi" ] && [ ! -e "$bin/tifusi-bot" ] && grep -q "Tifusi Bot — One-Line Installer" "$bin/tifusi"; then
    mv "$bin/tifusi" "$bin/tifusi-bot"
  fi
  place_command manage.sh "$bin/tifusi-panel"
  place_command scripts/tifusi "$bin/tifusi"
}

# A node server has no install directory of its own, so this takes the path to
# a checkout (install-node.sh's clone) rather than running from one.
install_node_commands() {
  local src=$1 bin=/usr/local/bin
  place_command "$src/scripts/manage-node.sh" "$bin/tifusi-node"
  place_command "$src/scripts/tifusi" "$bin/tifusi"
}
