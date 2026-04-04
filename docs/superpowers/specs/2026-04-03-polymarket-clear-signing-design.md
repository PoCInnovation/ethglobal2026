# Polymarket Clear Signing — Market Context Protocol (MCP)

**Date:** 2026-04-03
**Project:** Agent Payments with Ledger — device_app
**Scope:** Clear signing for Polymarket `fillOrder` (EIP-712) on Ledger devices

---

## Problem

Polymarket trades are signed as EIP-712 `Order` structs. The on-chain calldata and typed data contain opaque fields (`tokenId` as a uint256 hash, raw USDC amounts in base units). Without enrichment, the Ledger device displays raw hex/integers — unusable for a user to verify what they are signing.

Off-chain market data (question text, outcome name) cannot be fetched by the device itself. It must be provided by the companion app before signing.

---

## Solution: Market Context Protocol (MCP)

A dedicated APDU channel (`INS_PROVIDE_MARKET_CONTEXT = 0x3A`) that carries attested off-chain market context to the device **before** the EIP-712 signing instruction. The hash signed by the device is **unchanged** — MCP is purely a display enrichment channel.

### Non-negotiable invariants

1. The EIP-712 flow (`INS_SIGN_EIP_712_MESSAGE`) stays intact — no modification to the `Order` schema.
2. The hash signed in `ui_712_approve_cb()` is identical with or without MCP.
3. MCP is a parallel pre-signature channel only — never injected into typed data.

---

## Architecture

```
Web App (apps/web)
├── PolymarketContextLoader      ← NEW: fetches market data from Polymarket CLOB API
├── MCPAttester (backend)        ← NEW: signs MCP payload with attester keypair
└── ledger-provider.tsx          ← MODIFIED: sends MCP APDU before EIP-712

                    │
            USB/BLE (APDU)
                    │
                    ▼

Ledger Device (device_app fork of app-ethereum)
├── INS_PROVIDE_MARKET_CONTEXT (0x3A)   ← NEW APDU
│   └── TLV parser → verify → store context
│
└── INS_SIGN_EIP_712_MESSAGE            ← UNCHANGED
    ├── extract tokenId (no hash change)
    ├── check: MCP.tokenId == EIP712.tokenId
    ├── inject MCP screens into UI review
    └── sign (same hash as before)
```

---

## Device App Changes

### New APDU: `INS_PROVIDE_MARKET_CONTEXT = 0x3A`

**File:** `device_app/src/apdu_constants.h`

```c
#define INS_PROVIDE_MARKET_CONTEXT  0x3A
```

Chunking semantics: `p1=P1_FIRST_CHUNK` / `p1=P1_FOLLOWING_CHUNK` (mirrors `PROVIDE_TX_SIMULATION`).
Max payload: 1024 bytes total.

### New feature module: `src/features/provide_market_context/`

#### `mcp_tlv.h / mcp_tlv.c` — TLV parser

TLV tags:

| Tag | Name | Type | Max size |
|-----|------|------|----------|
| 0x01 | STRUCTURE_TYPE | uint8 | 1 |
| 0x02 | STRUCTURE_VERSION | uint8 | 1 |
| 0x03 | CHAIN_ID | uint64 | 8 |
| 0x04 | TOKEN_ID | bytes32 | 32 |
| 0x05 | ISSUED_AT | uint32 | 4 |
| 0x06 | EXPIRES_AT | uint32 | 4 |
| 0x07 | ATTESTER_ID | uint8 | 1 |
| 0x08 | FIELDS_BLOB | bytes | ≤512 |
| 0x09 | CONTEXT_HASH | bytes32 | 32 |
| 0x0A | DER_SIGNATURE | bytes | ≤72 |

`FIELDS_BLOB` encodes human-readable fields as length-prefixed key/value pairs (UTF-8 strings). Mandatory fields: `market.name`, `market.outcome`, `market.amount`. Additional fields rendered generically.

#### `market_context.h / market_context.c` — Internal state

```c
typedef struct {
    bool valid;
    bool verified;
    bool required;
    bool policy_fail_close;
    uint64_t chain_id;
    uint8_t  token_id[32];
    uint32_t issued_at;
    uint32_t expires_at;
    uint8_t  attester_id;
    uint8_t  fields_count;
    mcp_field_t fields[8];      // max 8 dynamic fields
    uint8_t  context_hash[32];
} market_context_t;
```

Lifecycle: initialized empty on boot, populated by APDU handler, consumed by EIP-712 UI, cleared in `reset_app_context()`.

#### `market_context_verify.c` — Cryptographic attestation

1. Recompute `context_hash` over canonical TLV blob (fields excluding CONTEXT_HASH and DER_SIGNATURE tags).
2. Verify `DER_SIGNATURE` with `check_signature_with_pubkey()` from `ledger_pki.c`.
3. Resolve `attester_id → pubkey` from versioned local table (`market_context_keys.c`).
4. Validate `chain_id`, `issued_at`, `expires_at`.

#### `market_context_render.h / market_context_render.c` — UI rendering

Renders MCP fields as UI pairs with type-aware formatting:

| Type | Format |
|------|--------|
| `string` | truncated display (Nano-safe) |
| `uint` | decimal |
| `decimal` | fixed-point (6 decimals for USDC) |
| `percent` | basis points → percentage |
| `address` | shortened hex |

Unknown field types displayed generically as `key: value`. Never fail on unknown type.

### Modified EIP-712 flow

**File:** `src/features/sign_message_eip712/commands_712.c`

At `handle_eip712_sign()`, enforce:
```c
if (market_context.valid && market_context.verified) {
    if (memcmp(market_context.token_id, extracted_token_id, 32) != 0 ||
        market_context.chain_id != eip712_context->chain_id) {
        // fail-close: return SWO_INCORRECT_DATA
        // fail-open: clear MCP, continue EIP-712 standard display
    }
}
```

**File:** `src/features/sign_message_eip712/field_hash.c`

Extract `tokenId` from EIP-712 message fields during parsing. Store in temporary variable for binding check. Hash computation is unaffected.

**File:** `src/features/sign_message_eip712/ui_logic.c`

Before `ui_712_end_sign()`, if MCP is valid and verified, push MCP display screens:
1. `Market` → `market.name`
2. `Outcome` → `market.outcome`
3. `Amount` → `market.amount`
4. Additional fields in arrival order

Standard EIP-712 field screens follow after MCP screens.

### Python client (for tests)

**File:** `device_app/client/src/ledger_app_clients/ethereum/command_builder.py`

```python
PROVIDE_MARKET_CONTEXT = 0x3A
```

Add `provide_market_context()` builder with chunking identical to `provide_tx_simulation()`.

---

## Web App Changes

### New: `apps/web/src/lib/polymarket-context.ts`

Responsibilities:
1. Detect Polymarket `fillOrder` EIP-712 message (by `primaryType == "Order"` and domain).
2. Extract `tokenId` from typed data message.
3. Fetch market metadata: `GET https://clob.polymarket.com/markets?clob_token_ids={tokenId}`.
4. Format `market.name` (truncated to 60 chars), `market.outcome`, `market.amount` (human-readable USDC).
5. Return structured context for MCP payload construction.

### New: Backend MCP attester

**File:** `apps/backend/src/market-context-attester.ts`

Responsibilities:
1. Receive market context request from web client.
2. Validate: tokenId exists on Polymarket, chainId matches Polygon.
3. Build canonical TLV payload with short TTL (5 minutes).
4. Sign with attester private key (Ed25519 or secp256k1).
5. Return signed MCP blob to web client.

Attester public key embedded in `market_context_keys.c` on device.

### Modified: `apps/web/src/lib/ledger-provider.tsx`

Before sending EIP-712 signing APDU:
1. If EIP-712 message is a Polymarket Order: call `polymarket-context.ts`.
2. Request attested MCP from backend.
3. Send `INS_PROVIDE_MARKET_CONTEXT` (chunked) to device.
4. Proceed with existing `INS_SIGN_EIP_712_MESSAGE` flow.

---

## Security Properties

| Property | Mechanism |
|----------|-----------|
| Context authenticity | DER signature from known attester |
| Context freshness | `issued_at` + `expires_at` (short TTL) |
| Context binding | `MCP.tokenId == EIP712.tokenId` enforced on device |
| Chain binding | `MCP.chainId == EIP712.chainId` enforced on device |
| Hash integrity | Signed hash identical with/without MCP |
| Malformed input | TLV parser bounds-checked, max 1024 bytes, max 8 fields |
| Policy | `fail-close` (default prod): MCP required → reject if invalid |

---

## Failure Modes

| Condition | fail-close | fail-open |
|-----------|-----------|-----------|
| MCP not sent | Reject EIP-712 sign | Continue standard display |
| Invalid signature | Reject | Ignore MCP, standard display |
| Expired | Reject | Ignore MCP, standard display |
| tokenId mismatch | Reject (`SWO_INCORRECT_DATA`) | Ignore MCP, standard display |
| Malformed TLV | Reject | Ignore MCP, standard display |

Default: `fail-close` for prod, `fail-open` for dev/debug.

---

## Files Summary

### New files — device_app
```
src/apdu_constants.h                              (modified: +0x3A)
src/main.c                                        (modified: +dispatch)
src/features/provide_market_context/
├── mcp_tlv.h
├── mcp_tlv.c
├── cmd_provide_market_context.h
├── cmd_provide_market_context.c
├── market_context.h
├── market_context.c
├── market_context_verify.c
├── market_context_keys.h
├── market_context_keys.c
├── market_context_render.h
└── market_context_render.c
src/features/sign_message_eip712/
├── commands_712.c                                (modified: +tokenId binding)
├── field_hash.c                                  (modified: +tokenId extraction)
└── ui_logic.c                                    (modified: +MCP screens)
```

### New files — apps/web + backend
```
apps/web/src/lib/polymarket-context.ts            (new)
apps/web/src/lib/ledger-provider.tsx              (modified: +MCP send)
apps/backend/src/market-context-attester.ts       (new)
```

### New files — tests
```
device_app/tests/ragger/test_market_context.py    (new)
device_app/client/src/ledger_app_clients/ethereum/
├── command_builder.py                            (modified: +0x3A)
└── client.py                                     (modified: +provide_market_context)
```

---

## Out of scope

- Modification du schéma `Order` EIP-712 Polymarket
- Mapping statique `tokenId → market` dans le firmware
- Support d'autres opérations Polymarket (redeem, split, merge) — phase 2
- Plugin externe (binaire séparé) — non nécessaire avec cette architecture
