# Agent Quickstart — Create a Payment Intent

**Prerequisites:** [Foundry](https://book.getfoundry.sh/getting-started/installation) (`cast`), `curl`, and `jq`.

## 1. Credential File

You need a JSON credential file with this shape:

```json
{
  "version": 1,
  "label": "My Agent",
  "trustchainId": "0x<owner-wallet-address>",
  "privateKey": "0x<hex-encoded-secp256k1-private-key>",
  "publicKey": "0x<hex-encoded-compressed-public-key>",
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

The human owner generates this file when registering your agent from the web UI.

> **Security:** Never commit this file to version control. Add it to `.gitignore` and restrict file permissions (`chmod 600`). The `privateKey` field is a secret — treat it like a password.

## 2. Build the AgentAuth Header

Every request to the API requires an `Authorization` header:

```
Authorization: AgentAuth <timestamp>.<bodyHash>.<signature>
```

| Part        | How to compute                                                                 |
|-------------|--------------------------------------------------------------------------------|
| `timestamp` | Current Unix epoch in **seconds** as a string (must be within 5 min of server time) |
| `bodyHash`  | `cast keccak "$BODY"` — returns `0x`-prefixed keccak256 hash. For GET requests (no body), use the literal string `0x` |
| `signature` | `cast wallet sign --private-key "$KEY" "$MESSAGE"` — returns `0x`-prefixed EIP-191 `personal_sign` over `"<timestamp>.<bodyHash>"` |

> **Important:** All hex values (`bodyHash`, `signature`) **must** include the `0x` prefix. Omitting it will result in a `401 Authentication failed` error.

### Body hashing

The `bodyHash` is computed over the **exact bytes** sent in the request body. Write the JSON body as a compact literal string (no extra whitespace between keys and values) to ensure a deterministic hash.

## 3. Send a Transfer Intent

**`POST https://www.agentintents.io/api/intents`**

### Request body

```json
{"agentId":"my-agent","agentName":"My Agent","details":{"type":"transfer","token":"USDC","amount":"1.00","recipient":"0xRecipientAddress","chainId":8453,"memo":"Reason for payment"},"urgency":"normal","expiresInMinutes":60}
```

### Response (`201 Created`)

```json
{
  "success": true,
  "intent": {
    "id": "int_1770399036079_804497de",
    "userId": "0x20bfb083c5adacc91c46ac4d37905d0447968166",
    "agentId": "my-agent",
    "agentName": "My Agent",
    "details": { ... },
    "urgency": "normal",
    "status": "pending",
    "trustChainId": "0x20bfb083c5adacc91c46ac4d37905d0447968166",
    "createdAt": "2026-02-06T17:30:36.127Z",
    "expiresAt": "2026-02-06T18:30:36.080Z",
    "statusHistory": [
      { "status": "pending", "timestamp": "2026-02-06T17:30:36.222Z" }
    ]
  },
  "paymentUrl": "https://www.agentintents.io/pay/int_1770399036079_804497de"
}
```

Share the `paymentUrl` with the human so they can review and sign the transaction.

## 4. Poll for Completion

**`GET https://www.agentintents.io/api/intents/<intent-id>`**

Poll until `status` is one of the terminal states: `confirmed`, `rejected`, `failed`, or `expired`.

---

## 5. Polymarket: Search Markets

**`GET https://www.agentintents.io/api/polymarket/markets?q=<search>&limit=<n>`**

No authentication required. Use this endpoint to find Polymarket markets by keyword before creating a trade intent.

### Parameters

| Parameter | Type   | Default | Description                        |
|-----------|--------|---------|------------------------------------|
| `q`       | string | `""`    | Search keyword (e.g. "bitcoin", "trump", "ethereum") |
| `limit`   | number | `10`    | Max results (1–50)                 |

### Example request

```bash
curl -s "https://www.agentintents.io/api/polymarket/markets?q=bitcoin&limit=5" | jq .
```

### Response

```json
{
  "success": true,
  "markets": [
    {
      "conditionId": "0xabc123...",
      "question": "Will Bitcoin hit $100k by July 2026?",
      "yesPrice": 0.65,
      "noPrice": 0.35,
      "volume": 1250000,
      "endDate": "2026-07-01T00:00:00.000Z",
      "active": true
    }
  ]
}
```

Use the `conditionId` from the search result to create a Polymarket trade intent.

## 6. Polymarket: Create a Trade Intent

**`POST https://www.agentintents.io/api/intents`**

### Request body

```json
{"agentId":"my-agent","agentName":"My Agent","details":{"type":"polymarket_trade","conditionId":"0xabc123...","outcome":"Yes","amount":"50","chainId":137,"memo":"I believe Bitcoin will hit 100k by July 2026 based on current momentum"},"urgency":"normal","expiresInMinutes":60}
```

### Fields

| Field         | Type   | Required | Description                                              |
|---------------|--------|----------|----------------------------------------------------------|
| `type`        | string | Yes      | Must be `"polymarket_trade"`                             |
| `conditionId` | string | Yes      | Polymarket condition ID (from search endpoint)           |
| `outcome`     | string | Yes      | `"Yes"` or `"No"`                                        |
| `amount`      | string | Yes      | Amount in USDC (e.g. `"50"`, `"100.50"`)                 |
| `chainId`     | number | Yes      | Must be `137` (Polygon)                                  |
| `memo`        | string | No       | Agent's justification for the trade (shown to the human) |

The backend automatically enriches the intent with the market title (`marketTitle`) and current outcome price (`outcomePrice`) from the Polymarket Gamma API.

### Response (`201 Created`)

Same structure as a transfer intent — includes `paymentUrl` for the human to review and sign.

---

## Complete Example: Transfer

```bash
#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────
CREDENTIAL_FILE="agent-credential.json"
PRIVATE_KEY=$(jq -r '.privateKey' "$CREDENTIAL_FILE")
AGENT_LABEL=$(jq -r '.label' "$CREDENTIAL_FILE")

# ── 1. Build compact JSON body ──────────────────────────────────
BODY=$(jq -cn \
  --arg agentName "$AGENT_LABEL" \
  '{
    agentId: "my-agent",
    agentName: $agentName,
    details: {
      type: "transfer",
      token: "USDC",
      amount: "1.00",
      recipient: "0xRecipientAddress",
      chainId: 8453,
      memo: "Reason for payment"
    },
    urgency: "normal",
    expiresInMinutes: 60
  }')

# ── 2. Compute auth header ──────────────────────────────────────
TIMESTAMP=$(date +%s)
BODY_HASH=$(cast keccak "$BODY")
SIGNATURE=$(cast wallet sign --private-key "$PRIVATE_KEY" "${TIMESTAMP}.${BODY_HASH}")

# ── 3. Send intent ──────────────────────────────────────────────
RESPONSE=$(curl -s -X POST "https://www.agentintents.io/api/intents" \
  -H "Content-Type: application/json" \
  -H "Authorization: AgentAuth ${TIMESTAMP}.${BODY_HASH}.${SIGNATURE}" \
  -d "$BODY")

echo "$RESPONSE" | jq .

PAYMENT_URL=$(echo "$RESPONSE" | jq -r '.paymentUrl')
echo ""
echo "Share this link with the human: $PAYMENT_URL"

# ── 4. Poll for completion ──────────────────────────────────────
INTENT_ID=$(echo "$RESPONSE" | jq -r '.intent.id')
STATUS="pending"

for i in $(seq 1 120); do
  case "$STATUS" in confirmed|rejected|failed|expired) break ;; esac
  sleep 30
  POLL_TS=$(date +%s)
  POLL_SIG=$(cast wallet sign --private-key "$PRIVATE_KEY" "${POLL_TS}.0x")
  STATUS=$(curl -s "https://www.agentintents.io/api/intents/${INTENT_ID}" \
    -H "Authorization: AgentAuth ${POLL_TS}.0x.${POLL_SIG}" \
    | jq -r '.intent.status')
  echo "Poll $i: status=$STATUS"
done

echo "Final status: $STATUS"
```

> **Tip:** `cast keccak` and `cast wallet sign` both return `0x`-prefixed output — no manual hex formatting needed.

## Complete Example: Polymarket Trade

```bash
#!/usr/bin/env bash
set -euo pipefail

CREDENTIAL_FILE="agent-credential.json"
PRIVATE_KEY=$(jq -r '.privateKey' "$CREDENTIAL_FILE")
AGENT_LABEL=$(jq -r '.label' "$CREDENTIAL_FILE")
BASE_URL="https://www.agentintents.io"

# ── 1. Search for a market ──────────────────────────────────────
echo "Searching for markets..."
MARKETS=$(curl -s "${BASE_URL}/api/polymarket/markets?q=bitcoin&limit=5")
echo "$MARKETS" | jq '.markets[] | {conditionId, question, yesPrice, noPrice}'

# Pick the first result (in practice, choose the most relevant)
CONDITION_ID=$(echo "$MARKETS" | jq -r '.markets[0].conditionId')
echo "Selected conditionId: $CONDITION_ID"

# ── 2. Build the polymarket_trade intent body ───────────────────
BODY=$(jq -cn \
  --arg agentName "$AGENT_LABEL" \
  --arg conditionId "$CONDITION_ID" \
  '{
    agentId: "my-agent",
    agentName: $agentName,
    details: {
      type: "polymarket_trade",
      conditionId: $conditionId,
      outcome: "Yes",
      amount: "50",
      chainId: 137,
      memo: "Based on current market analysis, this outcome is likely"
    },
    urgency: "normal",
    expiresInMinutes: 60
  }')

# ── 3. Compute auth header ──────────────────────────────────────
TIMESTAMP=$(date +%s)
BODY_HASH=$(cast keccak "$BODY")
SIGNATURE=$(cast wallet sign --private-key "$PRIVATE_KEY" "${TIMESTAMP}.${BODY_HASH}")

# ── 4. Send intent ──────────────────────────────────────────────
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/intents" \
  -H "Content-Type: application/json" \
  -H "Authorization: AgentAuth ${TIMESTAMP}.${BODY_HASH}.${SIGNATURE}" \
  -d "$BODY")

echo "$RESPONSE" | jq .

PAYMENT_URL=$(echo "$RESPONSE" | jq -r '.paymentUrl')
echo ""
echo "Share this link with the human to review and sign: $PAYMENT_URL"

# ── 5. Poll for completion ──────────────────────────────────────
INTENT_ID=$(echo "$RESPONSE" | jq -r '.intent.id')
STATUS="pending"

for i in $(seq 1 120); do
  case "$STATUS" in confirmed|rejected|failed|expired) break ;; esac
  sleep 30
  POLL_TS=$(date +%s)
  POLL_SIG=$(cast wallet sign --private-key "$PRIVATE_KEY" "${POLL_TS}.0x")
  STATUS=$(curl -s "${BASE_URL}/api/intents/${INTENT_ID}" \
    -H "Authorization: AgentAuth ${POLL_TS}.0x.${POLL_SIG}" \
    | jq -r '.intent.status')
  echo "Poll $i: status=$STATUS"
done

echo "Final status: $STATUS"
```

## Supported Chains

| Chain ID   | Name         | Token | Notes                    |
|------------|--------------|-------|--------------------------|
| 8453       | Base         | USDC  | Mainnet                  |
| 84532      | Base Sepolia | USDC  | Testnet                  |
| 11155111   | Sepolia      | USDC  | Testnet                  |
| 137        | Polygon      | USDC  | Polymarket trades only   |

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `401 Authentication failed` | Signature or body hash is malformed | Ensure `bodyHash` and `signature` are `0x`-prefixed hex strings |
| `401 Authentication failed` | Timestamp drift | Ensure your system clock is accurate (within 5 minutes of server time) |
| `401 Authentication failed` | Body hash mismatch | Ensure you hash the **exact** bytes sent as the request body (compact JSON, no trailing newline) |
| `400 Market not found` | Invalid `conditionId` | Use the search endpoint (`GET /api/polymarket/markets?q=...`) to find valid condition IDs |
| `400 Market is no longer active` | Market has closed or expired | Search for a different active market |
