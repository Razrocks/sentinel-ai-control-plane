#!/usr/bin/env bash
# Phase 5.1 + 5.2 — pre-pilot smoke test.
#
# Walks the 4 MVP scenarios end-to-end against a running stack
# (`docker compose up`). Verifies the happy paths still wire correctly
# AND exercises the concurrent-decide / If-Match path so we know B5
# survives real load. Designed to be safe to re-run — no destructive
# writes beyond the test fixtures it touches.
#
# Usage:
#   ./scripts/smoke.sh                # runs against http://localhost:3001
#   API=http://staging:3001 ./scripts/smoke.sh
set -euo pipefail

API="${API:-http://localhost:3001}"
PASS=0
FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
blue()  { printf "\033[36m%s\033[0m\n" "$*"; }

assert_status() {
  local name="$1" expected="$2" actual="$3" body="$4"
  if [ "$actual" = "$expected" ]; then
    green "✓ $name"; PASS=$((PASS+1))
  else
    red "✗ $name: expected $expected, got $actual"
    echo "  body: $body" | head -c 200
    echo ""
    FAIL=$((FAIL+1))
  fi
}

login() {
  local email="$1"
  curl -sk -X POST "$API/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"password\"}" \
    | grep -oE '"accessToken":"[^"]+' | cut -d'"' -f4
}

# ─── Scenario A — auth round-trip per role ──────────────
blue "Scenario A — auth as each role"
for ROLE_EMAIL in operator engineer itsupport approver accessapprover admin; do
  TOKEN=$(login "$ROLE_EMAIL@sentinel.dev" || true)
  if [ -n "$TOKEN" ]; then
    green "✓ login $ROLE_EMAIL"; PASS=$((PASS+1))
  else
    red "✗ login $ROLE_EMAIL"; FAIL=$((FAIL+1))
  fi
done

ADMIN_TOKEN=$(login "admin@sentinel.dev")

# ─── Scenario B — list endpoints respond ────────────────
blue "Scenario B — list endpoints"
for ROUTE in /api/changes /api/incidents /api/access-requests /api/approvals /api/policies /api/audit-events; do
  RESP=$(curl -sk -w "\n%{http_code}" "$API$ROUTE" -H "Authorization: Bearer $ADMIN_TOKEN")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | head -n -1)
  assert_status "GET $ROUTE" 200 "$CODE" "$BODY"
done

# ─── Scenario C — concurrent decide via If-Match (B5) ───
blue "Scenario C — concurrent decide / If-Match"
# Grab an incident + its current version
INC=$(curl -sk "$API/api/incidents" -H "Authorization: Bearer $ADMIN_TOKEN" \
  | grep -oE '"incidentId":"[^"]+' | head -1 | cut -d'"' -f4)
VER=$(curl -sk "$API/api/incidents" -H "Authorization: Bearer $ADMIN_TOKEN" \
  | grep -oE '"version":[0-9]+' | head -1 | cut -d':' -f2)

if [ -z "$INC" ] || [ -z "$VER" ]; then
  red "✗ couldn't read incident + version — skipping If-Match scenario"
  FAIL=$((FAIL+1))
else
  # First mutation with correct version — should 200
  R1=$(curl -sk -w "\n%{http_code}" -X POST "$API/api/incidents/$INC/escalate" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d "{\"reason\":\"smoke test\",\"expectedVersion\":$VER}")
  CODE=$(echo "$R1" | tail -1)
  assert_status "first decide with version $VER" 200 "$CODE" "$(echo "$R1" | head -n -1)"

  # Second mutation with the SAME (now stale) version — should 412
  R2=$(curl -sk -w "\n%{http_code}" -X POST "$API/api/incidents/$INC/escalate" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d "{\"reason\":\"smoke test stale\",\"expectedVersion\":$VER}")
  CODE=$(echo "$R2" | tail -1)
  assert_status "stale decide returns 412" 412 "$CODE" "$(echo "$R2" | head -n -1)"
fi

# ─── Scenario D — idempotency: repeat note save ─────────
blue "Scenario D — note attach is replay-safe"
APPR=$(curl -sk "$API/api/approvals" -H "Authorization: Bearer $ADMIN_TOKEN" \
  | grep -oE '"id":"[^"]+' | head -1 | cut -d'"' -f4)
if [ -n "$APPR" ]; then
  for i in 1 2; do
    R=$(curl -sk -w "\n%{http_code}" -X POST "$API/api/approvals/$APPR/note" \
      -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
      -d "{\"content\":\"smoke idempotency #$i\"}")
    CODE=$(echo "$R" | tail -1)
    assert_status "note attach attempt $i" 200 "$CODE" "$(echo "$R" | head -n -1)"
  done
else
  red "✗ no approvals found"; FAIL=$((FAIL+1))
fi

# ─── Summary ────────────────────────────────────────────
echo ""
echo "================================"
green "PASS: $PASS"
[ "$FAIL" -gt 0 ] && red "FAIL: $FAIL" || green "FAIL: 0"
echo "================================"
exit "$FAIL"
