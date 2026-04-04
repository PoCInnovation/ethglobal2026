# Polyledger Device App Rebrand & Screen Redesign

**Date:** 2026-04-04
**Target device:** Ledger Flex only
**Approach:** Surgical rebrand (Approach A) — change what users see, keep code structure intact

## Scope

Rebrand all user-visible Ethereum references to Polyledger/Polymarket, redesign the EIP-712 signing flow to be MCP-first, and hide Ethereum-only features from the UI.

## 1. String Changes

| File | Line | Current | New |
|------|------|---------|-----|
| `src/network.c` | 13 | `.name = "Ethereum"` | `.name = "Polyledger"` |
| `makefile_conf/chain/ethereum.mk` | 3 | `TICKER = "ETH"` | `TICKER = "USDC"` |
| `makefile_conf/chain/ethereum.mk` | 9 | `APPNAME = "Polyledger"` | Already correct, no change |
| `src/nbgl/ui_home.c` | 46 | `"Ledger", "Ledger (c) 2025"` | `"PoCInnovation", "PoCInnovation (c) 2025"` |
| `src/nbgl/ui_tx_simulation.c` | 158 | `"risky Ethereum transactions"` | `"risky transactions"` |

## 2. Icon Swaps (Flex only)

| File | Current | New |
|------|---------|-----|
| `icons/flex_app_chain_1.gif` | Ethereum diamond | Polymarket logo (already in repo) |
| `glyphs/chain_1_64px.gif` | Ethereum diamond 64px | Polymarket logo 64px (already in repo) |

## 3. Home Screen

- App name: "Polyledger" (from `network.c` chain_id=1 entry)
- Icon: Polymarket logo
- Tagline: In `ui_home.c` `get_appname_and_tagline()`, the standalone branch (`caller_app == NULL`) currently sets no tagline (NULL → NBGL default). Add a hardcoded tagline in that branch:
  `"This app enables clear\nsigning transactions for\nthe Polymarket dApp."`

## 4. About / Info Screen

| Field | Current | New |
|-------|---------|-----|
| Version | `APPVERSION` (unchanged) | `APPVERSION` |
| Developer | `"Ledger"` | `"PoCInnovation"` |
| Copyright | `"Ledger (c) 2025"` | `"PoCInnovation (c) 2025"` |

## 5. Signing Flow Redesign

### Review title
In `src/nbgl/ui_sign_712.c`, the `nbgl_useCaseAdvancedReview()` call at line 57-65:
- When `market_context_is_valid()`: title → `"Review order"`, finish → `"Sign order?"`
- When MCP not present: keep existing `"Review typed message"` / `"Sign typed message?"`

### MCP screen order (reordered for money-first)
In `src/features/sign_message_eip712/ui_logic.c` `ui_712_inject_mcp_screens()`:

**Current:** Market → Outcome → Shares → Price/Share → Total
**New:** Market → Outcome → Total → Shares → Price/Share

Rationale: The USDC total is the most critical piece of info after market and side. User sees what market, which side, and how much money in the first 3 screens.

### Review icon
When MCP is valid, use the Polyledger app icon instead of `ICON_APP_REVIEW` in the review flow.

### Skip button
Already implemented: `SKIPPABLE_OPERATION` is set when `market_context_is_valid()`. No change needed.

## 6. Hidden Features

### Etherscan QR code (`src/nbgl/ui_gcs.c:187-195`)
Short-circuit the Etherscan block so it never renders. Wrap the existing `if (get_tx_chain_id() == ETHEREUM_MAINNET_CHAINID)` block with `#if 0` / `#endif`. The code stays for reference but never compiles.

### Transaction Simulation opt-in (`src/nbgl/ui_tx_simulation.c`)
Already gated behind `HAVE_TRANSACTION_CHECKS` compile flag. Just remove the word "Ethereum" from the description string (done in Section 1 string changes).

## 7. Do NOT Change

These are protocol-level or internal constants that must stay as-is:

- `"\x19Ethereum Signed Message:\n"` in `cmd_sign_message.c` — EIP-191 protocol constant, changing breaks signature compatibility
- `ETHEREUM_MAINNET_CHAINID` macro in `chain_config.h` — internal logic, not user-visible
- `"Ethereum"` in `main.c:486` — OS library call name used by clone chains
- Other chain entries in `network.c` (Ropsten, Goerli, OP Mainnet, etc.) — not our branding
- File/directory names (`chain/ethereum.mk`, `ethereum-plugin-sdk/`) — renaming risks breaking the Ledger SDK build system

## 8. Test Snapshots

All Flex test snapshots under `device_app/tests/ragger/snapshots/` will need to be regenerated after the changes. The test code itself only needs comment updates (no functional changes).

## Files Modified (complete list)

1. `src/network.c` — chain_id=1 name
2. `makefile_conf/chain/ethereum.mk` — TICKER
3. `src/nbgl/ui_home.c` — about info, tagline for standalone mode
4. `src/nbgl/ui_tx_simulation.c` — remove "Ethereum" from description
5. `src/nbgl/ui_sign_712.c` — review/finish titles, review icon (conditional on MCP)
6. `src/features/sign_message_eip712/ui_logic.c` — MCP screen reorder
7. `src/nbgl/ui_gcs.c` — hide Etherscan QR block
8. `icons/flex_app_chain_1.gif` — swap to Polymarket logo
9. `glyphs/chain_1_64px.gif` — swap to Polymarket logo
