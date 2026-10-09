<sub>[← README](../../README.md) · 📦 [Installation](installation.md) · 🌐 [Nodes](nodes.md) · ⚛️ [Cores & hosts](cores-and-hosts.md) · 👤 [Users](users-and-subscriptions.md) · 💼 [Resellers](resellers.md) · 🚇 [Tunnels](tunnels.md) · 🛡️ [Connection Shield](connection-shield.md) · 🔀 [Domain rotation](domain-rotation.md) · ✈️ [Telegram bot](telegram-bot.md) · 📶 [Network health](network-health.md) · 🎛️ [Operations](operations.md) · 🔁 **Safe updates** · 🚢 [Deployment](deployment.md) · 📐 [Architecture](architecture.md) · 💻 [Development](development.md)</sub>

# Safe updates and rollback

Every change that reaches a server — a config push, a tunnel binary, a node agent image — is checked before it replaces what is running, and the last version that worked is kept so it can come back on its own. A bad change costs at most the few seconds of a restart, never a node that stays down. When an update finishes, a [short report](#update-report-on-telegram) goes to Telegram.

| What changes | Checked before | Kept for rollback | Rolled back when |
| --- | --- | --- | --- |
| Xray config (and the WireGuard Xray) | `xray run -test` on the new file | `<config>.good` | Xray rejects it, or exits within moments of starting |
| Hysteria2 config | — (no dry-run exists) | `<config>.good` | the server exits within moments of starting |
| strongSwan config | `swanctl --load-all` | previous `swanctl.conf` | swanctl refuses it |
| xl2tpd / pptpd config | — | previous files | the daemon exits right after the restart |
| Tunnel binary | `-version` and `-check` against the current config, SHA-256 | `tifusi-tunnel.prev` | the service doesn't stay up, or live links don't come back |
| Node agent image | self-test in a throwaway container | `tifusi-node-agent:rollback` | the agent doesn't answer, a healthy service isn't healthy afterwards, or the node drops during the soak |

## Config pushes on a node

The panel pushes a node's config whenever users or cores change. The node agent (`backend/node_agent/safe_apply.py`) applies each one in three steps:

1. **Validate first.** A new Xray config is written to a side file and checked with `xray run -test`, which parses and builds it without binding any port, so it is safe next to the running Xray. A config Xray can't load is refused and the running process is never touched.
2. **Write atomically.** Configs are written to a temporary file and renamed into place, so an interrupted write can't leave half a file for the next start.
3. **Keep the last good one.** Once a service has stayed up on a config, that config is copied to `<file>.good`. If the service exits within ~1.5 seconds of starting on a new one, the good copy goes back and the service starts again on it.

A config that already crashed is not tried again on the next push (the panel pushes on every user change, and retrying would cut users off over and over); it is refused until it changes. At startup the agent also falls back to the last good config if the current one doesn't come up.

A refusal comes back to the panel as HTTP 422 with the service, the reason, and whether the previous config is still serving. The panel shows it on the node — for example `xray rejected the new config (previous config still running): … unknown config id: …` — and does not mark a node that is still serving users as down.

## Reserved ports

A core can't be saved with an inbound, Hysteria2 port or WireGuard port on a port something on the node already listens on:

| Port | Used by |
| --- | --- |
| each node's agent port (62050 by default) | the node agent |
| 22 | SSH |
| 10085 | Xray stats API (loopback) |
| 10087 | WireGuard stats API (loopback) |
| 9998 | Hysteria2 stats API (loopback) |

Xray port forms are all checked: `443`, `"443"`, ranges like `62000-62100` and lists like `80,443`. A node's agent port is checked against the cores that node runs. Without this, an inbound on the agent's port would take the port first at container start and leave the agent unable to come up at all.

## Updating a tunnel

The tunnel's **SSH** sheet has an **🔄 Update tunnel** button per side ([Tunnels](tunnels.md#install-and-update-over-ssh)). The newest binary reaches the server — downloaded there from the release, or sent by the panel over SFTP when the server can't reach GitHub — with its SHA-256 checked. The swap then runs **on the server itself**, so a dropped SSH session can't leave it half done:

1. the new binary must run on that machine (`-version`) and accept the tunnel's current config (`-check`); otherwise nothing changes;
2. the running binary is kept as `tifusi-tunnel.prev`, the new one is moved in atomically and the service restarted;
3. the service must stay active, and if the tunnel had live links before, they must come back within 45 seconds (read from its loopback status endpoint);
4. otherwise `tifusi-tunnel.prev` goes back and the service restarts on it.

A side already running the newest binary isn't restarted. The tunnel's config is never changed by an update. Each update ends with the tunnel's health test.

## Updating node agents: canary rollout

A node's **SSH** sheet has an **Update** tab for one node; the Nodes page has **🔄 Rolling node update** for several. Both work in two layers:

**On the node** (a script run over SSH):

1. Get the new image: `docker pull` of `ghcr.io/javadtifusi-eng/tifusi-node-agent:<tag>`, or the image from the panel's [offline bundle](nodes.md#offline-install-bundle) uploaded over SFTP. The panel reads the image id from the archive first and skips the upload entirely when the node already runs it.
2. Self-test it in a throwaway container: Xray starts and the agent's code imports.
3. Tag the running image `tifusi-node-agent:rollback`.
4. Recreate the `tifusi-node` container exactly the way `install-node.sh` and `tifusi node update` do, carrying over the API key and port.
5. Wait up to 60 seconds for the agent to answer `/health`. If it doesn't, put the previous image back — on the node, without waiting for the panel.

**From the panel:** push the node's config to the new agent, require every service that was healthy before to be healthy after, then keep checking for a soak period. Any failure rolls the node back and pushes its config again at once, so Xray, IPsec and the rest are serving within seconds.

**Rollout:** the picked nodes are updated one at a time, in the order picked. The first is the canary and is watched longer (180 s by default; the rest 60 s). At the first node that fails, the rollout stops: that node is back on its previous image and the remaining nodes are not touched. Rollouts connect with the panel's own SSH key, so each node needs one password connection from its SSH sheet first.

A node's users drop for a few seconds while its container is replaced and reconnect on their own; a node can't serve during its own restart. To avoid even that, put two nodes behind one address.

## Updating the panel

`tifusi panel update` takes a safety snapshot before it changes anything, then rolls the panel back if the new version doesn't come up healthy — so an update that breaks costs a short restart, not a panel that stays down.

1. **Snapshot first.** The images the panel is running now are tagged `tifusi-panel-{backend,frontend}:rollback` (before the pull overwrites `:latest`), and the data (the database, `.env` and `certs/`) is saved under `<install>/.rollback/`.
2. **Update.** The latest install files are pulled, the prebuilt images fetched, and the panel restarted; migrations run on start.
3. **Health check.** The update waits up to 90 seconds for the backend container to be running and the API to answer. If it does, the update is kept and the snapshot is left in place until the next update.
4. **Roll back on failure.** If it doesn't, the previous images are put back. Because migrations only ever add tables and columns, the old code runs against the already-migrated schema, so this keeps every write made since the snapshot. Only if the old code still can't come up — a rare destructive migration — is the data snapshot restored too, and the panel brought up on it.

The database and `certs/` are never changed by a rollback unless the first layer fails, so a normal failed update loses nothing.

## Update report on Telegram

When an update finishes, the panel sends one short message to the Telegram chat set under **Settings → Telegram Notifications** (the same bot token and chat id as the other notifications):

| Update | When the report is sent | Result shown |
| --- | --- | --- |
| `tifusi panel update` | after the health check, or after a successful rollback | success, or rolled back to the previous version |
| One node's agent (the **Update** tab of its SSH sheet) | when the job ends | success or failed, with how long it took |
| **🔄 Rolling node update** | once, for the whole rollout | success or failed, with how long it took |
| A tunnel side (**🔄 Update tunnel**) | when the job ends | success or failed, with how long it took |

A failed report also carries the last error from the job's log. Every report ends with how many nodes are connected (and, when there are tunnels, how many are healthy) and the panel version. The message is written in Persian.

An update cancelled by hand sends nothing. The report is best-effort: with Telegram not set up, or Telegram unreachable, it is simply dropped and the update itself is unaffected. A panel update whose rollback also fails sends none either, since the panel isn't running to send it.

## Tests and CI

The same guarantees are covered by the automated suite ([Development](development.md#tests)): the agent's validation and rollback run against fake `xray`, `hysteria`, `swanctl` and `xl2tpd` binaries; the tunnel and node update scripts run for real against a fake `systemctl` and a fake `docker`; and the migration chain must have one head, reversible recent steps and models identical to the migrated schema. Images are only published after the suite passes.

---

<sub>[← Operations](operations.md) · [Deployment →](deployment.md)</sub>
