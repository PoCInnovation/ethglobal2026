# Polymarket Oracle — CRE Workflow

A Chainlink CRE workflow that acts as a decentralized oracle for Polymarket, feeding verified market data on-chain for Ledger clear signing.

## Why

Users trading on Polymarket through our app sign transactions on a Ledger hardware wallet. The Ledger plugin displays the market title (e.g. "Russia-Ukraine Ceasefire before GTA VI?") directly on the device screen — but only if that data comes from a **trusted on-chain source**. This CRE workflow is that source.

## Architecture

```
                          CRE Workflow (DON)
                    ┌─────────────────────────┐
  HTTP trigger      │  Step 1: Dual-source     │
  {marketIds:[...]} │  fetch + cross-validate  │
  ─────────────────►│  (Gamma API + CLOB API)  │
                    │          │                │
                    │  Consensus (identical)    │
                    │  All nodes must agree     │
                    │          │                │
                    │  Step 2: Read on-chain    │
                    │  oracle state (getMarket) │
                    │          │                │
                    │  Step 3: Compute delta    │
                    │  (new/changed only)       │
                    │          │                │
                    │  Step 4: Write delta      │
                    │  on-chain (writeReport)   │
                    └──────────┬──────────────┘
                               │
                               ▼
                    ┌─────────────────────────┐
                    │   PolymarketOracle.sol   │
                    │   (Sepolia)              │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │   PolyProxy.sol          │
                    │   reads oracle ──► trade │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │   Ledger Plugin          │
                    │   displays verified      │
                    │   market title on device │
                    └─────────────────────────┘
```

## CRE Features Used

| Feature | Usage |
|---------|-------|
| **HTTPClient** | Fetch market data from Gamma API + CLOB API |
| **Consensus (`identical`)** | All DON nodes must agree on the exact market data |
| **Consensus (`median`)** | Numeric consensus on market count |
| **EVMClient.callContract** | Read existing oracle state (finalized block) |
| **EVMClient.writeReport** | Write new/changed markets on-chain (ECDSA signed) |
| **Cross-source validation** | Each market verified across 2 independent Polymarket APIs |
| **Delta computation** | Only new or changed markets are written (no redundant gas) |

## How to Run

```bash
cd apps/CRE

# Simulate (no on-chain write)
cre workflow simulate ./polymarket-info --target staging-settings \
  --trigger-index 0 --non-interactive \
  --http-payload '{"marketIds": [540816, 540817]}'

# Simulate with broadcast (writes to Sepolia)
cre workflow simulate ./polymarket-info --target staging-settings \
  --trigger-index 0 --non-interactive \
  --http-payload '{"marketIds": [540816, 540817]}' --broadcast
```

## Contracts

- **PolymarketOracle** — `0xFe2842cda18fB514DA5cb7eA92bA9c726e4BfdCa` (Sepolia)
  - Receives CRE reports via `onReport()`, validates workflow identity
  - Stores `MarketInfo` structs: conditionId, question, endDate, active, lastUpdate
  - Integrates **Chainlink USDC/USD Price Feed** (`0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E`) for depeg protection
