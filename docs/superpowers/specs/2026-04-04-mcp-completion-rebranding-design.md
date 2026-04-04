# MCP Completion + Polymarket Rebranding — Design Spec

## Scope

Complete remaining MCP (Market Context Protocol) implementation in the Ledger device app and rebrand from "Ethereum" to "Polymarket".

## 1. Rebranding

### App Name
- `makefile_conf/chain/ethereum.mk`: Change `APPNAME = "Ethereum"` to `APPNAME = "Polymarket"`

### Icon Generation
Generate Polymarket logo (green "P" in hexagonal shape) as GIF files at required sizes:

**icons/** (app icons per device):
- `nanox_app_chain_1.gif` — 14x14
- `stax_app_chain_1.gif` — 32x32
- `flex_app_chain_1.gif` — 40x40
- `apex_app_chain_1.gif` — 32x32

**glyphs/** (UI glyphs):
- `chain_1_14px.gif` — 14x14
- `chain_1_48px.gif` — 48x48
- `chain_1_64px.gif` — 64x64
- `home_chain_1_14px.gif` — 14x14

All GIFs must be GIF89a format with transparency, matching the Ledger SDK requirements (indexed color, 1-bit or 4-bit depth depending on device).

## 2. TTL Verification (Step 5 completion)

**File:** `src/features/provide_market_context/mcp_tlv.c`

After signature verification in `mcp_parse_payload()`:
- Validate `expires_at > issued_at` (sanity check)
- If fails: clear context, return false

No real-time clock check — the Ledger device has no reliable RTC. The host application is responsible for enforcing TTL freshness before sending MCP to the device.

## 3. tokenId Binding (Step 6 completion)

**File:** `src/features/sign_message_eip712/commands_712.c`

In `handle_eip712_sign()`, after chain_id check:
- Extract `tokenId` field from the parsed EIP-712 message context
- Compare 32 bytes with `g_market_context.token_id`
- On mismatch: `market_context_clear()`, set `SWO_INCORRECT_DATA`, abort

**Dependency:** Need to find where EIP-712 field values are accessible during signing. The `tokenId` is a bytes32 field in the Polymarket Order typed data. Will use the existing field extraction mechanism from the EIP-712 parser.

## 4. Additional Tests (Step 9 completion)

**File:** `tests/ragger/test_market_context.py`

New test cases:
- `test_mcp_expired_payload` — `expires_at < issued_at` → MCP rejected (0x6A80)
- `test_mcp_token_id_mismatch` — MCP tokenId differs from EIP-712 message tokenId → sign aborted
- `test_mcp_large_payload_chunking` — payload with 128-char market name forces multi-chunk APDU → succeeds

## 5. Fuzzing Harness (Step 10)

**File:** `tests/fuzzing/src/fuzz_market_context.c`

Basic harness calling `mcp_parse_payload()` with fuzz input. Follows pattern of existing `fuzz_eip712.c`. Validates no crashes, buffer overflows, or undefined behavior on arbitrary input.

## Non-goals

- Web/backend integration (step 11) — separate project
- Rollout/feature flags (step 12) — not needed for hackathon
- Real-time TTL enforcement on device — no reliable RTC
