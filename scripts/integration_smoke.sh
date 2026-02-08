#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:8080}"
TOKEN="${TOKEN:-}"
if [ -z "$TOKEN" ]; then
  TOKEN=$(node -e "console.log(require('jsonwebtoken').sign({uid:'u_smoke'}, process.env.JWT_SECRET||'replace_me'))")
fi
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

echo "1) start"
START=$(curl -s "$BASE/api/gameplay/v1/game/start" "${AUTH[@]}" -d '{"uid":"u_smoke","levelId":1}')
echo "$START"
TOKEN_SESSION=$(echo "$START" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(j.data.sessionToken||'')}catch{console.log('')}})")

echo "2) finish"
curl -s "$BASE/api/gameplay/v1/game/finish" "${AUTH[@]}" -d "{\"uid\":\"u_smoke\",\"levelId\":1,\"result\":\"success\",\"score\":999,\"durationSec\":60,\"stars\":3,\"sessionToken\":\"$TOKEN_SESSION\"}"; echo

echo "3) ad reward"
curl -s "$BASE/api/ad/v1/ad/reward/claim" "${AUTH[@]}" -d '{"uid":"u_smoke","scene":"revive","adTicket":"smoke_ticket_001"}'; echo

echo "4) payment verify"
curl -s "$BASE/api/payment/v1/payment/verify" "${AUTH[@]}" -d '{"uid":"u_smoke","sku":"starter_pack_6","platformOrderId":"smoke_order_001"}'; echo

echo "5) user progress"
curl -s "$BASE/api/user/v1/user/progress?uid=u_smoke" "${AUTH[@]}"; echo

echo "✅ smoke done"
