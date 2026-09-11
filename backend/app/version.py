from pathlib import Path

# WORKDIR is /app in the container; backend/Dockerfile COPYs this file to
# /app/VERSION right next to the /app/app package this module lives in.
_VERSION_FILE = Path(__file__).resolve().parent.parent / "VERSION"

try:
    __version__ = _VERSION_FILE.read_text().strip()
except OSError:
    __version__ = "0.0.0"
