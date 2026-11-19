#!/usr/bin/env bash
# Diễn tập chuyển dữ liệu từng chủ trọ trên BẢN SAO LƯU D1 — hoàn toàn local, không đụng production.
#   scripts/rehearse-migration.sh <đường-dẫn-file-sao-lưu.sql> [thư-mục-kết-quả] [ownerId ownerId ...]
# Mặc định chạy chủ trọ 4 rồi 1. File sao lưu chứa dữ liệu thật: không đặt trong repo, không commit,
# không in nội dung; báo cáo chỉ gồm số đếm và cờ ok. Dữ liệu local nằm trong thư mục tạm ngoài repo, xoá khi xong.
set -uo pipefail

BACKUP="${1:-}"
[ -f "$BACKUP" ] || { echo "Dùng: $0 <file-sao-lưu.sql> [thư-mục-kết-quả] [ownerId...]" >&2; exit 2; }
BACKUP="$(cd "$(dirname "$BACKUP")" && pwd)/$(basename "$BACKUP")"
CF="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${2:-$(mktemp -d)}"; mkdir -p "$OUT"
shift $(( $# >= 2 ? 2 : $# ))
OWNERS=("${@:-4 1}"); [ $# -gt 0 ] || OWNERS=(4 1)
PERSIST="$(mktemp -d)"
FAIL=0
WORKER_PID=""
cd "$CF"

cleanup() {
  [ -n "$WORKER_PID" ] && kill "$WORKER_PID" 2>/dev/null && wait "$WORKER_PID" 2>/dev/null
  rm -rf "$PERSIST" "$PERSIST.sql"
}
trap cleanup EXIT INT TERM

W=(npx wrangler)
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
  END { printf "%s%s", head, body }' "$BACKUP" > "$PERSIST.sql"
d1 --file "$PERSIST.sql" > "$OUT/01-load.log" 2>&1 || { echo "Không nạp được bản sao lưu, xem $OUT/01-load.log" >&2; exit 1; }
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
"${W[@]}" dev --local --port "$PORT" --persist-to "$PERSIST" --var "JWT_SECRET:$(openssl rand -hex 32)" > "$OUT/04-worker.log" 2>&1 &
WORKER_PID=$!
BASE="http://127.0.0.1:$PORT"
for _ in $(seq 1 90); do
  curl -s -o /dev/null "$BASE/api/me" && break
  kill -0 "$WORKER_PID" 2>/dev/null || { echo "wrangler dev dừng sớm, xem $OUT/04-worker.log" >&2; exit 1; }
  sleep 1
done
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

curl -s -H "Authorization: Bearer $TROHUB_DEV_TOKEN" "$BASE/api/dev/storage" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);for(const o of j.owners)console.log(`    owner ${o.ownerId}: backend=${o.backend} houses=${o.houses}`)})' | tee "$OUT/90-storage.txt"

[ "$FAIL" -eq 0 ] && echo "==> DIỄN TẬP ĐẠT: mọi bước ok, API đọc giống hệt." || echo "==> DIỄN TẬP KHÔNG ĐẠT" >&2
echo "    kết quả trong $OUT"
exit "$FAIL"
