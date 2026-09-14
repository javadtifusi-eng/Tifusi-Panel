# Installs the `tifusi-panel` command and the shared `tifusi` launcher (scripts/tifusi).
# Sourced by install.sh and manage.sh from the install directory.

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
