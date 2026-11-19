#!/usr/bin/env bash
# Diễn tập chuyển dữ liệu từng chủ trọ trên BẢN SAO LƯU D1 — hoàn toàn local, không đụng production.
#   scripts/rehearse-migration.sh <đường-dẫn-file-sao-lưu.sql> [thư-mục-kết-quả] [ownerId ownerId ...]
# Mặc định chạy chủ trọ 4 rồi 1. File sao lưu chứa dữ liệu thật: không đặt trong repo, không commit,
# không in nội dung; báo cáo chỉ gồm số đếm và cờ ok. Dữ liệu local nằm trong thư mục tạm ngoài repo, xoá khi xong.
set -uo pipefail
umask 077 # everything created here may hold personal data: owner-only

BACKUP="${1:-}"
[ -f "$BACKUP" ] || { echo "Dùng: $0 <file-sao-lưu.sql> [thư-mục-kết-quả] [ownerId...]" >&2; exit 2; }
BACKUP="$(cd "$(dirname "$BACKUP")" && pwd)/$(basename "$BACKUP")"
CF="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${2:-$(mktemp -d)}"; mkdir -p "$OUT"; chmod 700 "$OUT"
shift $(( $# >= 2 ? 2 : $# ))
OWNERS=("${@:-4 1}"); [ $# -gt 0 ] || OWNERS=(4 1)
PERSIST="$(mktemp -d)"
FAIL=0
WORKER_PID=""
cd "$CF"

# Linux: wrangler dev gets its own process group (setsid) and the whole group is stopped. macOS has no setsid
# (or set REHEARSE_NO_SETSID=1 to force this path): walk the children with pgrep -P and also stop anything whose
# command line names this run's unique temp dir. Never a bare pkill workerd, so other sessions are untouched.
if [ -z "${REHEARSE_NO_SETSID:-}" ] && command -v setsid > /dev/null 2>&1; then
  USE_SETSID=1
elif command -v pgrep > /dev/null 2>&1 && command -v pkill > /dev/null 2>&1; then
  USE_SETSID=0
else
  echo "Cần setsid (Linux) hoặc pgrep và pkill (macOS) để dừng wrangler dev sạch sẽ." >&2; exit 2
fi
descendants() { local c; for c in $(pgrep -P "$1" 2>/dev/null); do echo "$c"; descendants "$c"; done; }

cleanup() {
  local pid="$WORKER_PID" tree=""
  WORKER_PID="" # a second run of this trap must not touch a PID that may have been reused
  if [ -n "$pid" ]; then
    if [ "$USE_SETSID" = 1 ]; then
      kill -- "-$pid" 2>/dev/null
      sleep 1
      kill -9 -- "-$pid" 2>/dev/null
    else
      tree="$pid $(descendants "$pid")" # collect before killing: orphans lose their parent
      kill $tree 2>/dev/null
      pkill -f "$PERSIST" 2>/dev/null
      sleep 1
      kill -9 $tree 2>/dev/null
      pkill -9 -f "$PERSIST" 2>/dev/null
    fi
    wait "$pid" 2>/dev/null
  fi
  rm -rf "$PERSIST"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# No Cloudflare credentials reach wrangler: everything here is local.
W=(env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID npx wrangler)
d1() { "${W[@]}" d1 execute tro-hub --local --persist-to "$PERSIST" "$@"; }
count() { d1 --json --command "$1" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s)[0].results[0].n)}catch{console.log("?")}})'; }

echo "==> Nạp bản sao lưu vào D1 local ($PERSIST)"
# A D1 export lists "staff" after the tables that point at it; a local load checks foreign keys per statement, so
# the staff table and its rows are moved to the top (a copy in the throwaway dir; the backup file is not touched).
awk '
  /^CREATE TABLE IF NOT EXISTS "staff"/ { grab = 1 }
  grab { head = head $0 "\n"; if ($0 ~ /\);[[:space:]]*$/) grab = 0; next }
  /^INSERT INTO "staff"/ { head = head $0 "\n"; next }
  { body = body $0 "\n" }
  END { printf "%s%s", head, body }' "$BACKUP" > "$PERSIST/backup-reordered.sql"
d1 --file "$PERSIST/backup-reordered.sql" > "$OUT/01-load.log" 2>&1 || { echo "Không nạp được bản sao lưu, xem $OUT/01-load.log" >&2; exit 1; }
echo "    migrations đã áp trong bản sao lưu: $(count 'SELECT COUNT(*) AS n FROM d1_migrations')"

echo "==> Áp các migration còn lại (0016 trở đi)"
"${W[@]}" d1 migrations apply tro-hub --local --persist-to "$PERSIST" > "$OUT/02-migrations.log" 2>&1 || { echo "migrations apply lỗi, xem $OUT/02-migrations.log" >&2; exit 1; }
echo "    migrations sau khi áp: $(count 'SELECT COUNT(*) AS n FROM d1_migrations')"

echo "==> Số dòng D1 trước khi chuyển"
for t in houses house_rates rooms residents invoices meter_readings payments payment_gates notifications; do
  echo "    $t: $(count "SELECT COUNT(*) AS n FROM $t")"
done | tee "$OUT/03-d1-counts.txt"
echo "    payments không có nhà: $(count 'SELECT COUNT(*) AS n FROM payments WHERE house_id IS NULL')" | tee -a "$OUT/03-d1-counts.txt"

# Local-only Developer login: a random password is written as the hash of the Developer row in THIS throwaway
# database (the backup's real password is not needed). Neither the password nor the token is ever printed.
LOCAL_PW="$(openssl rand -hex 16)"
HASH="$(LOCAL_PW="$LOCAL_PW" node -e 'import("./src/password.ts").then(async m=>console.log(await m.hashPassword(process.env.LOCAL_PW)))')"
DEV_PHONE="$(d1 --json --command "SELECT phone AS n FROM staff WHERE role='developer' ORDER BY id LIMIT 1" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].results[0].n))')"
[ -n "$DEV_PHONE" ] && [ -n "$HASH" ] || { echo "Không tìm thấy tài khoản Developer trong bản sao lưu." >&2; exit 1; }
d1 --command "UPDATE staff SET password_hash='$HASH', status='active' WHERE role='developer'" > /dev/null 2>&1 || { echo "Không đặt được mật khẩu local cho Developer." >&2; exit 1; }

PORT="$(node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})')"
echo "==> Chạy wrangler dev --local trên cổng $PORT"
printf 'JWT_SECRET=%s\n' "$(openssl rand -hex 32)" > "$PERSIST/dev.env" # throwaway signing key, not in argv
DEV=("${W[@]}" dev --local --port "$PORT" --persist-to "$PERSIST" --env-file "$PERSIST/dev.env")
if [ "$USE_SETSID" = 1 ]; then setsid "${DEV[@]}" > "$OUT/04-worker.log" 2>&1 & else "${DEV[@]}" > "$OUT/04-worker.log" 2>&1 & fi
WORKER_PID=$!
BASE="http://127.0.0.1:$PORT"
READY=0
for _ in $(seq 1 90); do
  curl -s -o /dev/null "$BASE/api/me" && { READY=1; break; }
  kill -0 "$WORKER_PID" 2>/dev/null || { echo "wrangler dev dừng sớm, xem $OUT/04-worker.log" >&2; exit 1; }
  sleep 1
done
[ "$READY" = 1 ] || { echo "wrangler dev không trả lời sau 90 giây, xem $OUT/04-worker.log" >&2; exit 1; }
TROHUB_DEV_TOKEN="$(LOCAL_PW="$LOCAL_PW" DEV_PHONE="$DEV_PHONE" node -e '
  fetch(process.argv[1]+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({phone:process.env.DEV_PHONE,password:process.env.LOCAL_PW})})
    .then(r=>r.json()).then(j=>{ if(!j.token){console.error("Đăng nhập Developer local thất bại");process.exit(1)} process.stdout.write(j.token)})' "$BASE")" || exit 1
export TROHUB_DEV_TOKEN
unset LOCAL_PW HASH

step() { # step <tên> <lệnh> <ownerId>
  local name="$1" cmd="$2" owner="$3" start end rc
  start=$(date +%s)
  node scripts/migrate-tenant.mts "$cmd" "$owner" --base "$BASE" > "$OUT/$name.txt" 2>&1
  rc=$?
  end=$(date +%s)
  echo "==> $cmd $owner: exit $rc, $((end - start)) s (kết quả: $OUT/$name.txt)"
  [ "$rc" -eq 0 ] || { echo "    THẤT BẠI (ok=false hoặc API đọc khác nhau)"; FAIL=1; }
}

n=10
for o in "${OWNERS[@]}"; do step "$((n++))-dry-run-$o" dry-run "$o"; done
for o in "${OWNERS[@]}"; do step "$((n++))-migrate-$o" migrate "$o"; done
first="${OWNERS[0]}"
step "$((n++))-rollback-$first" rollback "$first"
step "$((n++))-migrate-again-$first" migrate "$first"

# The token goes to curl through stdin config, not argv.
printf 'header = "Authorization: Bearer %s"\n' "$TROHUB_DEV_TOKEN" | curl -s -K - "$BASE/api/dev/storage" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);for(const o of j.owners)console.log(`    owner ${o.ownerId}: backend=${o.backend} houses=${o.houses}`)}catch{process.exit(1)}})' > "$OUT/90-storage.txt"
[ $? -eq 0 ] || { echo "    Không đọc được /api/dev/storage"; FAIL=1; }
cat "$OUT/90-storage.txt"

[ "$FAIL" -eq 0 ] && echo "==> DIỄN TẬP ĐẠT: mọi bước ok, API đọc giống hệt." || echo "==> DIỄN TẬP KHÔNG ĐẠT" >&2
echo "    kết quả trong $OUT"
exit "$FAIL"
