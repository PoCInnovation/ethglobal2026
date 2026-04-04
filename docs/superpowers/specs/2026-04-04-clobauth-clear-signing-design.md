# ClobAuth Clear Signing Design

**Date:** 2026-04-04
**Scope:** Add clear signing for Polymarket ClobAuth EIP-712 messages so the Ledger shows "Connect to Polymarket" + wallet address instead of raw typed data fields.

## Overview

When a user connects to Polymarket from the web app Settings page, they sign a `ClobAuth` EIP-712 message on their Ledger. Currently the Ledger shows generic "Review typed message" with raw fields (address, timestamp, nonce, message hash). This feature adds clear signing so the Ledger shows human-readable screens: the service name ("Polymarket") and the wallet address being authorized, with a "Connect to Polymarket?" confirm button.

## Architecture

Three layers, reusing the existing MCP (Market Context Protocol) infrastructure:

1. **Device app** — New TLV struct type `TYPE_AUTH = 0x0B` parsed via the existing `INS_PROVIDE_MARKET_CONTEXT (0x3A)` APDU. Populates an `auth_context_t` and injects auth-specific UI screens.
2. **Backend** — Extend `/api/market-context/sign` to accept `type: "auth"` and build a lighter auth TLV payload.
3. **Frontend** — Detect `ClobAuth` typed data in `signTypedDataV4()` and send an auth MCP payload to the device before signing.

## 1. Device App Changes

### New constants (`mcp_tlv.h`)

```c
#define MCP_AUTH_STRUCT_TYPE  0x0B

#define TAG_MCP_AUTH_LABEL   0x70
#define TAG_MCP_AUTH_ADDRESS 0x71
```

### New auth context (`auth_context.h`)

```c
#define MCP_AUTH_LABEL_MAX   64
#define MCP_AUTH_ADDRESS_MAX 42  // "0x" + 40 hex chars

typedef struct {
    bool valid;
    bool verified;
    uint64_t chain_id;
    uint32_t issued_at;
    uint32_t expires_at;
    char auth_label[MCP_AUTH_LABEL_MAX + 1];    // e.g. "Polymarket"
    char auth_address[MCP_AUTH_ADDRESS_MAX + 1]; // e.g. "0x1234...abcd"
} auth_context_t;

extern auth_context_t g_auth_context;
extern bool g_auth_context_fresh;

void auth_context_clear(void);
bool auth_context_is_valid(void);
void auth_context_consume_or_clear(void);
```

### TLV parser (`auth_tlv.h` / `auth_tlv.c`)

New TLV parser following the same X-macro pattern as `mcp_tlv.c`:
- Tags: `STRUCT_TYPE`, `STRUCT_VERSION`, `CHAIN_ID`, `ISSUED_AT`, `EXPIRES_AT`, `AUTH_LABEL`, `AUTH_ADDRESS`, `DER_SIGNATURE`
- Mandatory tags: all of the above
- Same signature verification with `MCP_ATTESTER_PUBLIC_KEY`
- Same TTL sanity check (`expires_at > issued_at`)
- On success: `g_auth_context.valid = true`, `g_auth_context.verified = true`, `g_auth_context_fresh = true`

### APDU handler update (`cmd_provide_market_context.c`)

The existing handler receives the TLV payload via `tlv_from_apdu()`. After receiving the full payload, read the struct type byte before dispatching to a parser:
1. Read the first 3 bytes of the buffer: `tag(1) + length(1) + value(1)`. If `tag != 0x01` (TAG_MCP_STRUCT_TYPE) or `length != 1`, return `SWO_INCORRECT_DATA`.
2. If value `== 0x0A` (order): call `mcp_parse_payload()` as today
3. If value `== 0x0B` (auth): call `auth_parse_payload()` (new)
4. Otherwise: return `SWO_INCORRECT_DATA`

Both parsers receive the full buffer (including the struct type tag) and re-parse from the start — the peek is only for routing.

### UI injection (`ui_logic.c`)

Add `ui_712_inject_auth_screens()` alongside the existing `ui_712_inject_mcp_screens()`:

```c
static void ui_712_inject_auth_screens(void) {
    if (!auth_context_is_valid()) return;

    s_ui_712_pair *service = mcp_alloc_pair("Service", g_auth_context.auth_label);
    s_ui_712_pair *address = mcp_alloc_pair("Address", g_auth_context.auth_address);

    if (!service || !address) return;

    ((flist_node_t *) service)->next = (flist_node_t *) address;
    ((flist_node_t *) address)->next = (flist_node_t *) ui_ctx->ui_pairs;
    ui_ctx->ui_pairs = service;
}
```

Call both in `ui_712_end_sign()`:
```c
ui_712_inject_mcp_screens();
ui_712_inject_auth_screens();
```

Only one will inject (the other returns early if its context is not valid).

### Review titles (`ui_sign_712.c`)

Extend the MCP-aware logic already in `ui_712_start_review()`:

```c
bool mcp_active = market_context_is_valid();
bool auth_active = auth_context_is_valid();

// Title suffix
if (mcp_active) title_suffix = " order?";
else if (auth_active) title_suffix = " to Polymarket?";  // → "Connect to Polymarket?"
else title_suffix = " typed message?";

// Finish button prefix
if (auth_active) tx_check_str = "Connect";  // → "Connect to Polymarket?"

// Review title
if (mcp_active) review_title = "Review order";
else if (auth_active) review_title = "Connect to Polymarket";
else review_title = "Review typed message";

// Icon
icon = (mcp_active || auth_active) ? get_app_icon(false) : &ICON_APP_REVIEW;
```

### Binding check

For auth payloads, skip the `token_id` binding check in `commands_712.c` — ClobAuth messages don't have a tokenId field. Check: if `auth_context_is_valid()`, only verify `chain_id` matches (`137` for Polymarket).

### Stale context clearing

Add `auth_context_consume_or_clear()` in `eip712_context_init()` alongside the existing `market_context_consume_or_clear()`.

## 2. Backend Changes

### Extend `/api/market-context/sign`

Add `type` field to the request body:

```typescript
interface SignRequest {
  type?: "order" | "auth";  // default: "order"
  // existing order fields...
  chainId?: number;
  // auth-specific fields:
  label?: string;    // e.g. "Polymarket"
  address?: string;  // e.g. "0x1234..."
}
```

When `type === "auth"`:
- Build TLV with tags: `STRUCT_TYPE(0x0B)`, `STRUCT_VERSION(0x01)`, `CHAIN_ID`, `ISSUED_AT`, `EXPIRES_AT`, `AUTH_LABEL`, `AUTH_ADDRESS`, `DER_SIGNATURE`
- No token_id, no market fields
- Same signing with `MCP_ATTESTER_PRIVATE_KEY_PEM`
- Return `{ tlvHex: "..." }`

## 3. Frontend Changes

### Detect ClobAuth in `ledger-provider.tsx`

Add detection function:
```typescript
function isClobAuth(typedData: EIP712TypedData): boolean {
  return typedData.primaryType === "ClobAuth";
}
```

In `signTypedDataV4()`, after the existing `isPolymarketOrder()` check:
```typescript
if (isClobAuth(typedData)) {
  const authContext = {
    type: "auth" as const,
    chainId: typedData.domain.chainId,
    label: "Polymarket",
    address: typedData.message.address,
  };
  const { tlvHex } = await fetchSignedMCPPayload(authContext);
  await sendMcpApdu(dmk, sessionId, tlvHex);
}
```

### `buildAuthContext()` in `polymarket-context.ts`

```typescript
export function buildAuthContext(typedData: EIP712TypedData) {
  return {
    type: "auth" as const,
    chainId: Number(typedData.domain.chainId),
    label: "Polymarket",
    address: String(typedData.message.address),
  };
}
```

### `fetchSignedMCPPayload()` already exists

The existing function posts to `/api/market-context/sign`. Just pass the auth fields — the backend handles the rest based on `type`.

## Files Modified (complete list)

### Device app (`device_app/src/`)
1. `features/provide_market_context/mcp_tlv.h` — add `MCP_AUTH_STRUCT_TYPE`, `TAG_MCP_AUTH_LABEL`, `TAG_MCP_AUTH_ADDRESS`
2. `features/provide_market_context/auth_context.h` — new file: `auth_context_t` struct and API
3. `features/provide_market_context/auth_context.c` — new file: auth context state management
4. `features/provide_market_context/auth_tlv.h` — new file: auth TLV parser declaration
5. `features/provide_market_context/auth_tlv.c` — new file: auth TLV parser implementation
6. `features/provide_market_context/cmd_provide_market_context.c` — route by struct type
7. `features/sign_message_eip712/ui_logic.c` — add `ui_712_inject_auth_screens()`
8. `features/sign_message_eip712/commands_712.c` — skip tokenId check for auth context
9. `nbgl/ui_sign_712.c` — auth-aware review titles
10. `features/sign_message_eip712/context_712.c` — add `auth_context_consume_or_clear()`

### Web app (`apps/web/`)
11. `src/lib/ledger-provider.tsx` — add `isClobAuth()` detection + auth MCP flow
12. `src/lib/polymarket-context.ts` — add `buildAuthContext()` function
13. `api/market-context/sign.ts` — handle `type: "auth"` TLV building

### Tests
14. `device_app/tests/ragger/test_auth_context.py` — new: auth MCP APDU tests
15. `device_app/client/src/ledger_app_clients/ethereum/market_context.py` — add `AuthContext` class for test client
