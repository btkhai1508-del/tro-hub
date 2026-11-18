#!/usr/bin/env bash
# Chạy Trọ Hub trên máy mình: Worker (cổng 8787, D1 local) + giao diện/Express (cổng 3000).
#   npm run dev:local            chạy (lần đầu tự cài và tạo dữ liệu mẫu)
#   npm run dev:local -- --reset xoá D1 local, tạo lại dữ liệu mẫu rồi chạy
# Tài khoản mẫu, mật khẩu đều là "1": Developer 0918338863 · chủ trọ 0902371800
#   · quản lý 0900000001 · cư dân 0900000101, 0900000201.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CF="$ROOT/cloudflare"
cd "$ROOT"

[ -d node_modules ] || npm install --no-audit --no-fund
[ -d "$CF/node_modules" ] || (cd "$CF" && npm install --no-audit --no-fund)

# Khoá ký phiên đăng nhập của Worker khi chạy local (file đã nằm trong .gitignore).
if [ ! -f "$CF/.dev.vars" ]; then
  printf 'JWT_SECRET=%s\n' "$(openssl rand -hex 32)" > "$CF/.dev.vars"
fi

if [ "${1:-}" = "--reset" ]; then rm -rf "$CF/.wrangler/state"; fi

cd "$CF"
mkdir -p .wrangler
FRESH=0
[ -d .wrangler/state/v3/d1 ] || FRESH=1
npx wrangler d1 migrations apply tro-hub --local
if [ "$FRESH" = 1 ]; then npm run db:seed:local; fi

npx wrangler dev --port 8787 &
WORKER_PID=$!
trap 'kill $WORKER_PID 2>/dev/null' EXIT INT TERM

cd "$ROOT"
echo
echo "==> Mở http://localhost:3000 (Worker: http://localhost:8787)"
echo
WORKER_API_URL=http://localhost:8787 \
VITE_WORKER_API_URL=http://localhost:8787 \
VITE_API_BASE_URL=http://localhost:3000 \
PORT=3000 npm run dev
