"""Docker's actual entrypoint for the node agent — replaces a bare `uvicorn
node_agent.main:app` CLI invocation so the self-signed TLS cert (see
node_agent/tls.py) is generated and on disk *before* uvicorn ever tries to
load it into an SSL context, instead of relying on module-import ordering
to get that sequencing right.
"""
import os

import uvicorn

from node_agent import tls
from node_agent.main import CONFIG_PATH, app

CERT_FILE = CONFIG_PATH.parent / "agent-cert.pem"
KEY_FILE = CONFIG_PATH.parent / "agent-key.pem"


def main() -> None:
    tls.ensure_self_signed_cert(CERT_FILE, KEY_FILE)
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("AGENT_PORT", "62050")),
        ssl_certfile=str(CERT_FILE),
        ssl_keyfile=str(KEY_FILE),
    )


if __name__ == "__main__":
    main()
