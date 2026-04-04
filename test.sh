#!/usr/bin/env bash
# Crée un intent via l'API. Il faut un serveur qui expose /api (ex. `vercel dev` dans apps/web).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_AUTH_HELPER="${AGENT_AUTH_HELPER:-$ROOT/apps/web/scripts/agent-auth-header.mjs}"

# --- Config ---
CREDENTIAL_FILE="${CREDENTIAL_FILE:-$ROOT/agent-credential.json}"
PRIVATE_KEY=$(jq -r '.privateKey' "$CREDENTIAL_FILE")
AGENT_ADDRESS=$(cast wallet address --private-key "$PRIVATE_KEY")
echo "Agent address: $AGENT_ADDRESS"
AGENT_LABEL=$(jq -r '.label' "$CREDENTIAL_FILE")
API_URL="${API_URL:-http://localhost:3005}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
AGENT_ID="${AGENT_ID:-my-agent}"

# Optional: force a specific event slug / question
EVENT_SLUG="${EVENT_SLUG:-}"
QUESTION_SUBSTR="${QUESTION_SUBSTR:-}"

# Helper: POST auth — bodyHash must match server (viem keccak256(toHex(body)), NOT cast keccak)
agent_auth_header_post() {
  node "$AGENT_AUTH_HELPER" post "$1" "$CREDENTIAL_FILE"
}

# Helper: GET auth (no body → bodyHash = literal 0x)
agent_auth_header_get() {
  node "$AGENT_AUTH_HELPER" get "$CREDENTIAL_FILE"
}

# --- 1) Find an active + open market ---
if [[ -n "$EVENT_SLUG" ]]; then
  echo ""
  echo "=== Step 1: Fetch markets from Gamma (event slug=$EVENT_SLUG) ==="
  GAMMA_RAW=$(curl -sS "https://gamma-api.polymarket.com/events?slug=${EVENT_SLUG}")
  CONDITION_ID=$(echo "$GAMMA_RAW" | jq -r --arg q "$QUESTION_SUBSTR" '
      [.[0].markets[]
       | select(.active == true and .closed == false)
       | select(if $q != "" then (.question | contains($q)) else true end)]
      | first
      | .conditionId // empty')
  MARKET_Q=$(echo "$GAMMA_RAW" | jq -r --arg cid "$CONDITION_ID" '
      [.[0].markets[] | select(.conditionId == $cid)] | first | .question // "?"')
else
  echo ""
  echo "=== Step 1: Search for ANY active+open market on Gamma ==="
  GAMMA_RAW=$(curl -sS 'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=10')
  CONDITION_ID=$(echo "$GAMMA_RAW" | jq -r '
    [.[] | select(.active == true and .closed == false
           and (.conditionId | test("^0x[a-fA-F0-9]{64}$")))]
    | first | .conditionId // empty')
  MARKET_Q=$(echo "$GAMMA_RAW" | jq -r --arg cid "$CONDITION_ID" '
    [.[] | select(.conditionId == $cid)] | first | .question // "?"')
fi

if [[ -z "$CONDITION_ID" || "$CONDITION_ID" == "null" ]]; then
  echo "ERROR: No active+open market found."
  echo "Active markets returned by Gamma:"
  echo "$GAMMA_RAW" | jq '.[0:5] | .[] | {question, active, closed, conditionId}' 2>/dev/null || echo "$GAMMA_RAW" | head -c 1000
  exit 1
fi
echo "  Market: $MARKET_Q"
echo "  conditionId: $CONDITION_ID"

# --- 2) Build request body ---
echo ""
echo "=== Step 2: Build intent body ==="
BODY=$(jq -cn \
  --arg agentId "$AGENT_ID" \
  --arg agentName "$AGENT_LABEL" \
  --arg cid "$CONDITION_ID" \
  '{
    agentId: $agentId,
    agentName: $agentName,
    details: {
      type: "polymarket_trade",
      conditionId: $cid,
      outcome: "Yes",
      amount: "10",
      chainId: 137,
      memo: "CLI test — active market"
    },
    urgency: "normal",
    expiresInMinutes: 60
  }')
echo "  Body (compact): $BODY"

# --- 3) Sign and POST ---
echo ""
echo "=== Step 3: POST /api/intents ==="
AUTH=$(agent_auth_header_post "$BODY")
echo "  Auth header: ${AUTH:0:80}..."
  echo "  API URL: ${API_URL}/api/intents"
  echo "  Frontend: ${FRONTEND_URL}"

RESP_FILE=$(mktemp)
HTTP_CODE=$(curl -sS -o "$RESP_FILE" -w '%{http_code}' -X POST "${API_URL}/api/intents" \
  -H "Content-Type: application/json" \
  -H "Authorization: $AUTH" \
  -d "$BODY")
RESPONSE=$(<"$RESP_FILE")
rm -f "$RESP_FILE"

echo ""
echo "=== Response ==="
echo "  HTTP status: $HTTP_CODE"
echo "  Body length: ${#RESPONSE} chars"
if [[ -z "$RESPONSE" ]]; then
  echo "  (empty body — is vercel dev running?)"
  exit 1
elif echo "$RESPONSE" | jq . 2>/dev/null; then
  :
else
  echo "  (not JSON — raw body truncated below)"
  printf '%s\n' "$RESPONSE" | head -c 2000
  echo ""
  exit 1
fi

if [[ $(echo "$RESPONSE" | jq -r '.success // false' 2>/dev/null || echo false) != "true" ]]; then
  ERR=$(echo "$RESPONSE" | jq -r '.error // empty' 2>/dev/null || true)
  echo "  FAILED: ${ERR:-HTTP $HTTP_CODE}" >&2
  exit 1
fi

INTENT_ID=$(echo "$RESPONSE" | jq -r '.intent.id')
PAYMENT_URL="${FRONTEND_URL}/pay/${INTENT_ID}"
echo ""
echo "=== SUCCESS ==="
echo "  Intent ID:   $INTENT_ID"
echo "  Payment URL: $PAYMENT_URL"

# --- 4) Poll status ---
echo ""
echo "=== Step 4: Poll intent status (Ctrl+C to stop) ==="
STATUS="pending"
for i in $(seq 1 60); do
  case "$STATUS" in confirmed|rejected|failed|expired) break ;; esac
  sleep 5
  GA=$(agent_auth_header_get)
  POLL_RESP=$(curl -sS "${API_URL}/api/intents/${INTENT_ID}" -H "Authorization: $GA")
  STATUS=$(echo "$POLL_RESP" | jq -r '.intent.status // empty' 2>/dev/null || echo "parse_error")
  echo "  poll #$i: status=$STATUS"
done
echo ""
echo "Final status: $STATUS"