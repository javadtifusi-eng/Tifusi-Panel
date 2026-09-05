#!/usr/bin/env bash
# Tifusi Panel installer — clones the repo, brings the panel up with Docker
# Compose, then optionally creates the first admin account and a node right
# from this same terminal session, instead of a separate trip to the browser.
#
# Usage:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install.sh)"

set -euo pipefail

REPO_URL="https://github.com/javadtifusi-eng/Tifusi-Panel.git"
INSTALL_DIR="${TIFUSI_INSTALL_DIR:-/opt/tifusi-panel}"
PANEL_URL="http://localhost:8000"

info() { printf '\033[1;36m[تیفوسی]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[هشدار]\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m[خطا]\033[0m %s\n' "$1"; exit 1; }

# Minimal JSON string escaping (backslash and double-quote) — enough for the
# values this script actually sends (usernames, passwords, node names), not
# a general-purpose JSON encoder.
json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# Pulls one top-level field's value out of a JSON response — tolerant of
# whether the server puts a space after the colon (grep -o '"field":"..."'
# with no space allowance silently returns nothing the moment that varies,
# which is exactly the kind of thing that only shows up once against a real
# server, not a hand-typed test payload).
json_field() {
  printf '%s' "$1" | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*(\"[^\"]*\"|[0-9]+)" | head -n1 \
    | sed -E "s/^\"$2\"[[:space:]]*:[[:space:]]*//; s/^\"//; s/\"\$//"
}

command -v docker >/dev/null 2>&1 \
  || fail "داکر نصب نیست. اول این رو اجرا کن: curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 \
  || fail "پلاگین docker compose نصب نیست یا قدیمیه — داکر رو آپدیت کن."

if [ -f "docker-compose.yml" ] && [ -d "backend" ] && [ -d "frontend" ]; then
  INSTALL_DIR="$(pwd)"
  info "از همین پوشه‌ی فعلی ($INSTALL_DIR) نصب می‌کنم."
elif [ -d "$INSTALL_DIR/.git" ]; then
  info "ریپو از قبل تو $INSTALL_DIR هست، آپدیتش می‌کنم..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "کلون کردن ریپو تو $INSTALL_DIR..."
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  awk -v s="$SECRET" '{gsub(/^TIFUSI_SECRET_KEY=.*/, "TIFUSI_SECRET_KEY=" s)}1' .env > .env.tmp
  mv .env.tmp .env
  info "یه TIFUSI_SECRET_KEY تصادفی تو .env ساخته شد."
fi

info "بالا آوردن پنل با Docker Compose (ممکنه چند دقیقه طول بکشه)..."
docker compose up -d --build

info "منتظر آماده شدن پنل..."
ready=""
for _ in $(seq 1 60); do
  if curl -fsS "$PANEL_URL/api/setup/status" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[ -n "$ready" ] || fail "پنل تو مهلت انتظار بالا نیومد — لاگ‌ها رو چک کن: docker compose logs panel"

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST_IP="${HOST_IP:-<server-ip>}"
info "پنل بالا اومد."
info "  آدرس پنل (API):  http://${HOST_IP}:8000"
info "  آدرس داشبورد:    http://${HOST_IP}:8080"

TOKEN=""
read -r -p "می‌خوای همین الان از همین ترمینال حساب مدیر رو بسازی؟ [Y/n] " make_admin
make_admin=${make_admin:-Y}
if [[ "$make_admin" =~ ^[Yy]$ ]]; then
  KEY_OUTPUT=$(docker exec tifusi-panel tifusi-cli generate-admin-key)
  SETUP_KEY=$(printf '%s\n' "$KEY_OUTPUT" | grep -Ev '^(Setup|Paste|$)' | tail -n1 | tr -d '[:space:]')

  read -r -p "نام کاربری مدیر: " admin_user
  read -r -s -p "رمز عبور مدیر (حداقل ۸ کاراکتر): " admin_pass
  echo

  RESPONSE=$(curl -fsS -X POST "$PANEL_URL/api/setup/create-admin" \
    -H "Content-Type: application/json" \
    -d @- <<JSON
{"key": "$(json_escape "$SETUP_KEY")", "username": "$(json_escape "$admin_user")", "password": "$(json_escape "$admin_pass")"}
JSON
  ) || fail "ساخت حساب مدیر ناموفق بود — از داخل مرورگر امتحان کن."
  unset admin_pass

  TOKEN=$(json_field "$RESPONSE" access_token)
  [ -n "$TOKEN" ] || fail "پاسخ غیرمنتظره از پنل: $RESPONSE"
  info "حساب مدیر ساخته شد."
else
  info "باشه — بعداً از داخل مرورگر: docker exec -it tifusi-panel tifusi-cli generate-admin-key"
fi

if [ -n "$TOKEN" ]; then
  warn "معمولاً توصیه نمی‌شه سرور خودِ پنل رو به‌عنوان نود (سرور واقعیِ Xray) هم استفاده کنی — بهتره پنل و نودها جدا باشن. ولی برای شروع سریع، این گزینه هم جواب می‌ده."
  read -r -p "می‌خوای یه نود هم رو همین سرور نصب کنی؟ [y/N] " make_node
  make_node=${make_node:-N}
  if [[ "$make_node" =~ ^[Yy]$ ]]; then
    read -r -p "اسم نود [Local Node]: " node_name
    node_name=${node_name:-"Local Node"}
    read -r -p "پورت نود [62050]: " node_port
    node_port=${node_port:-62050}

    NODE_RESPONSE=$(curl -fsS -X POST "$PANEL_URL/api/nodes" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d @- <<JSON
{"name": "$(json_escape "$node_name")", "address": "127.0.0.1", "port": $node_port}
JSON
    ) || fail "ساخت نود ناموفق بود."
    NODE_ID=$(json_field "$NODE_RESPONSE" id)
    NODE_KEY=$(json_field "$NODE_RESPONSE" api_key)
    [ -n "$NODE_ID" ] && [ -n "$NODE_KEY" ] || fail "پاسخ غیرمنتظره از پنل: $NODE_RESPONSE"

    info "ساخت ایمیج نود..."
    docker build -t tifusi-node-agent -f backend/node_agent/Dockerfile backend

    if docker ps -a --format '{{.Names}}' | grep -qx tifusi-node; then
      docker rm -f tifusi-node >/dev/null
    fi
    info "اجرای نود..."
    docker run -d --name tifusi-node --restart unless-stopped \
      -p "${node_port}:62050" -e "TIFUSI_NODE_API_KEY=${NODE_KEY}" tifusi-node-agent

    info "همگام‌سازی اولیه..."
    sleep 2
    curl -fsS -X POST "$PANEL_URL/api/nodes/${NODE_ID}/sync" -H "Authorization: Bearer $TOKEN" >/dev/null \
      || warn "همگام‌سازی اولیه ناموفق بود — از داخل پنل، تب «نودها»، دستی بزن."

    info "نود ساخته و اجرا شد. وضعیتش رو از تب «نودها» تو پنل چک کن."
  fi
fi

info "تموم شد."
