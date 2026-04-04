# Agent Quickstart — Create a Payment Intent

**Prerequisites:** [Node.js](https://nodejs.org/) (for AgentAuth hashing/signing), `curl`, and `jq`. Optional: [Foundry](https://book.getfoundry.sh/getting-started/installation) (`cast`) for wallet utilities — **do not** use `cast keccak` for `bodyHash` (see below).

## 0. Public doc mirror (doc_ethcc.vibecallin.com)

If you host a copy of this page or `agent-context.json` on a public hostname (e.g. `doc_ethcc.vibecallin.com`):

- Serve it over **HTTPS** with a valid TLS certificate.
- **Redirect** all `http://` requests to `https://` (301).
- After HTTPS is stable, send **`Strict-Transport-Security`** (HSTS) with an appropriate `max-age`.
- Serve **`/agent-context.json`** with **`Content-Type: application/json`**.

Canonical mirror URLs (use `https://` only once TLS is enabled):

- Page: `https://doc_ethcc.vibecallin.com/agent-context`
- JSON: `https://doc_ethcc.vibecallin.com/agent-context.json`

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
| `bodyHash`  | **`keccak256(toHex(rawBody))` in viem** — same as the API implementation. For GET requests (no body), use the literal string `0x`. **Do not use `cast keccak`**; it hashes differently and causes `401`. |
| `signature` | EIP-191 `personal_sign` of `"<timestamp>.<bodyHash>"` with the agent private key (`0x` prefix). In shell, use the repo helper below or sign in code with viem/ethers. |

> **Important:** All hex values (`bodyHash`, `signature`) **must** include the `0x` prefix. Omitting it will result in a `401 Authentication failed` error.

### Body hashing

The `bodyHash` is computed over the **exact bytes** sent in the request body. Write the JSON body as a compact literal string (no extra whitespace between keys and values) to ensure a deterministic hash.

### Shell helper (matches production)

From the repository root (requires `pnpm install` in the monorepo so `viem` is available under `apps/web`):

```bash
# POST: pass the exact JSON string used as curl -d
AUTH=$(node apps/web/scripts/agent-auth-header.mjs post "$BODY" "$CREDENTIAL_FILE")

# GET: body hash is always 0x
AUTH=$(node apps/web/scripts/agent-auth-header.mjs get "$CREDENTIAL_FILE")
```

Then pass `-H "Authorization: $AUTH"` to `curl`.

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

Poll until `status` is one of the terminal states: `authorized` (Polymarket order signed), `confirmed`, `rejected`, `failed`, or `expired`.

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

The backend automatically enriches the intent with the market title (`marketTitle`), current outcome price (`outcomePrice`), and CLOB token ID (`tokenId`) from the Polymarket CLOB API (with Gamma API fallback).

### Response (`201 Created`)

Same structure as a transfer intent — includes `paymentUrl` for the human to review and sign.

---

## Complete Example: Transfer

```bash
#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────
CREDENTIAL_FILE="agent-credential.json"
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

# ── 2. Build auth header (viem-compatible; do not use cast keccak) ───────────
AUTH=$(node apps/web/scripts/agent-auth-header.mjs post "$BODY" "$CREDENTIAL_FILE")

# ── 3. Send intent ──────────────────────────────────────────────
RESPONSE=$(curl -s -X POST "https://www.agentintents.io/api/intents" \
  -H "Content-Type: application/json" \
  -H "Authorization: $AUTH" \
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
  POLL_AUTH=$(node apps/web/scripts/agent-auth-header.mjs get "$CREDENTIAL_FILE")
  STATUS=$(curl -s "https://www.agentintents.io/api/intents/${INTENT_ID}" \
    -H "Authorization: $POLL_AUTH" \
    | jq -r '.intent.status')
  echo "Poll $i: status=$STATUS"
done

echo "Final status: $STATUS"
```

## Complete Example: Polymarket Trade

```bash
#!/usr/bin/env bash
set -euo pipefail

CREDENTIAL_FILE="agent-credential.json"
AGENT_LABEL=$(jq -r '.label' "$CREDENTIAL_FILE")
BASE_URL="https://www.agentintents.io"

# ── 1. Search for a market ──────────────────────────────────────
echo "Searching for markets..."
MARKETS=$(curl -s "${BASE_URL}/api/polymarket/markets?q=bitcoin&limit=5")
# If the response is HTML (SPA) instead of JSON, use Gamma directly, e.g.:
# curl -sS "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=20&order=volume&ascending=false"
echo "$MARKETS" | jq '.markets[]? | {conditionId, question, yesPrice, noPrice}' 2>/dev/null || {
  echo "Markets endpoint did not return JSON; check deployment or use gamma-api.polymarket.com" >&2
  exit 1
}

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

# ── 3. Build auth header (viem-compatible) ─────────────────────
AUTH=$(node apps/web/scripts/agent-auth-header.mjs post "$BODY" "$CREDENTIAL_FILE")

# ── 4. Send intent ──────────────────────────────────────────────
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/intents" \
  -H "Content-Type: application/json" \
  -H "Authorization: $AUTH" \
  -d "$BODY")

echo "$RESPONSE" | jq .

PAYMENT_URL=$(echo "$RESPONSE" | jq -r '.paymentUrl')
echo ""
echo "Share this link with the human to review and sign: $PAYMENT_URL"

# ── 5. Poll for completion ──────────────────────────────────────
# For polymarket_trade, "authorized" = user signed the order on Ledger.
INTENT_ID=$(echo "$RESPONSE" | jq -r '.intent.id')
STATUS="pending"

for i in $(seq 1 120); do
  case "$STATUS" in authorized|confirmed|rejected|failed|expired) break ;; esac
  sleep 30
  POLL_AUTH=$(node apps/web/scripts/agent-auth-header.mjs get "$CREDENTIAL_FILE")
  STATUS=$(curl -s "${BASE_URL}/api/intents/${INTENT_ID}" \
    -H "Authorization: $POLL_AUTH" \
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
| `401 Authentication failed` | Body hash mismatch | Use **viem** `keccak256(toHex(body))` or `apps/web/scripts/agent-auth-header.mjs` — **not** `cast keccak` |
| `401 Authentication failed` | Wrong hashing tool | `cast keccak` does **not** match the server; always use viem or the provided Node helper |
| `400 Market not found` | Invalid `conditionId` | Use the search endpoint (`GET /api/polymarket/markets?q=...`) to find valid condition IDs |
| `400 Market is no longer active` | Market has closed or expired | Search for a different active market |
