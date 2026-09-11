#!/usr/bin/env bash
# One-shot: once Let's Encrypt's per-domain rate limit window reopens, grab
# a real publicly-trusted certificate for de.koledemb.ir and wire it into
# both (a) the dashboard's own HTTPS (certs/fullchain.pem + privkey.pem)
# and (b) the IKEv2 Core's certificate fields, replacing the self-signed
# one. A publicly-trusted cert needs no CA-trust payload/profile on the
# client at all — iOS/Windows already trust Let's Encrypt's root, so native
# manual IKEv2 setup (no .mobileconfig) works immediately, which is the
# actual reason this kept failing: the self-signed CA can only be trusted
# through a profile, and testing was always done via manual entry.
#
# Scheduled once via crontab for shortly after the rate-limit reset time;
# removes its own crontab line on exit either way so it never re-fires.
set -uo pipefail

cd /root/Tifusi-Panel
LOG=/root/Tifusi-Panel/scripts/renew-ikev2-cert.log
exec >>"$LOG" 2>&1
echo "=== $(date -u) : starting ==="

crontab -l 2>/dev/null | grep -v renew-ikev2-cert.sh | crontab -

mkdir -p certs letsencrypt-work
if ! docker run --rm -p 80:80 -v "$(pwd)/letsencrypt-work:/etc/letsencrypt" \
  certbot/certbot certonly --standalone --non-interactive --agree-tos \
  -m "admin@de.koledemb.ir" -d "de.koledemb.ir"; then
  echo "certbot failed — will need a manual retry"
  exit 1
fi

cp "letsencrypt-work/live/de.koledemb.ir/fullchain.pem" certs/fullchain.pem
cp "letsencrypt-work/live/de.koledemb.ir/privkey.pem" certs/privkey.pem
echo "Certificate obtained."

# Dashboard HTTPS: point it at the real cert and switch the public URL over.
if ! grep -q '^TIFUSI_PUBLIC_URL=https://de.koledemb.ir' .env; then
  sed -i '/^TIFUSI_PUBLIC_URL=/d' .env
  echo "TIFUSI_PUBLIC_URL=https://de.koledemb.ir" >> .env
fi
docker compose up -d dashboard

# IKEv2 Core: swap in the same cert/key (fullchain = leaf+intermediate,
# exactly the "leaf with its issuing CA appended" shape ikev2_profile.py's
# _ca_certificate_der already expects — and a chain a real client already
# trusts needs no CA-trust payload/profile at all), then push it to every
# node using an ikev2 Core.
docker compose exec -T panel python3 <<'PYEOF'
import asyncio, sys
sys.path.insert(0, "/app")
from sqlalchemy import select
from app.database import async_session
from app.models.core import Core, CoreType
from app.models.node import Node
from app.nodes.sync import sync_node

async def main():
    cert = open("/app/certs/fullchain.pem").read()
    key = open("/app/certs/privkey.pem").read()
    async with async_session() as db:
        cores = (await db.execute(select(Core).where(Core.core_type == CoreType.ikev2))).scalars().all()
        for core in cores:
            core.ikev2_certificate = cert
            core.ikev2_certificate_key = key
            db.add(core)
        await db.commit()
        print(f"Updated {len(cores)} ikev2 core(s).")

        nodes = (await db.execute(
            select(Node).where(Node.ipsec_core_id.in_([c.id for c in cores]))
        )).scalars().all()
        for node in nodes:
            try:
                result = await sync_node(node, db)
                print(f"Synced node {node.id}: {result}")
            except Exception as e:
                print(f"Sync failed for node {node.id}: {e}")

asyncio.run(main())
PYEOF
echo "=== $(date -u) : done ==="
