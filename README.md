# Polyledger

> **"Agents propose. Humans verify. Ledger signs."**

Trade on Polymarket with AI-powered analysis and hardware wallet security. AI agents propose trades, an **AI council** deliberates, and you sign on your Ledger device with **our custom device app** that shows exactly what you're buying — market name, outcome, price, and amount — verified by a **Chainlink CRE oracle**.

Built at [ETH Global Cannes 2026](https://ethglobal.com/events/cannes) by **the PoC Innovation Team**.

---

## How It Works

1. An **AI agent** proposes a Polymarket trade (e.g. "Buy Yes on next French president")
2. An **AI council** (Bull, Bear, Quant) independently analyzes the trade and votes
3. You review the trade details and council verdict in the web app
4. Your **Ledger device** displays the market info in plain text — no raw hex
5. You confirm on the device, the order is submitted to **Polymarket's CLOB**
6. Your positions appear in the **Portfolio** tab

### The Problem

Trading on prediction markets requires trusting opaque transaction data. When you sign a Polymarket order, your wallet shows raw EIP-712 fields — hex addresses, token IDs, and atomic amounts. You can't tell if you're buying "Yes" on the next Elon Musk Tweet or approving a drain.

### The Solution

**Polyledger** adds three layers of protection:

1. **AI Council** — Three AI agents (Bull, Bear, Quant) independently analyze each trade and vote before you see it
2. **Chainlink CRE Oracle** — Market metadata is fetched, cross-validated across multiple sources, and written on-chain by a decentralized oracle network
3. **Custom Ledger Device App** — Your Ledger displays human-readable market info (name, side, outcome, price) instead of raw hex, verified by the oracle's cryptographic signature

---

## Architecture

| Component | Description |
|-----------|-------------|
| **Device App** | Custom Ledger app (forked from Ethereum app) that displays Polymarket market info on the device screen during signing |
| **Web App** | React UI — intent review, AI council deliberation, Ledger signing, portfolio tracking |
| **Backend** | Express API — intent queue, Polymarket CLOB proxy, market context signer, credential storage |
| **CRE Oracle** | Chainlink CRE workflow — decentralized market data verification written on-chain |
| **Shared** | TypeScript types for intents, Polymarket trades, and status lifecycle |

---

## Custom Ledger Device App

The `device_app/` directory is a **fork of the official Ledger Ethereum app** ([LedgerHQ/app-ethereum](https://github.com/LedgerHQ/app-ethereum)), renamed **Polyledger**.

When you sign a Polymarket order, instead of seeing raw EIP-712 data, the Ledger displays 6 screens:

| Screen | Example |
|--------|---------|
| **Market** | "Will Eric Zemmour win the 2027 French presidential election?" |
| **Side** | "Buy" |
| **Outcome** | "Yes" |
| **Total** | "1.00 USDC" |
| **Shares** | "100.00 shares" |
| **Price/Share** | "0.0100 USDC" |

The market data shown on the device is cryptographically signed by a backend attester service. The device verifies this signature before displaying — ensuring what you see matches the actual order.

---

## Chainlink CRE Oracle

A **Chainlink CRE** (Chainlink Runtime Environment) workflow fetches Polymarket market data from two independent sources (Gamma API + CLOB API), validates consistency across all DON nodes, and writes verified data on-chain.

This gives the Ledger device a **trusted on-chain source** for market metadata — the same data displayed on screen during signing.

**Smart contract**: `0xB7A357155344456af8FeAC6C9E4504642E60362e` (PolymarketOracle.sol) on Sepolia — stores verified market info (title, condition ID, end date) and integrates a Chainlink USDC/USD price feed for stablecoin depeg protection.

---

## AI Council

Before a trade reaches your Ledger, three AI agents independently analyze it:

| Agent | Role |
|-------|------|
| **Bull** | Optimistic analyst — looks for upside, momentum, catalysts |
| **Bear** | Risk analyst — identifies downside risks, overpricing |
| **Quant** | Data analyst — evaluates implied probability, expected value |

Each agent deliberates in real-time (streamed to the UI), then casts a **FOR** or **AGAINST** vote. The verdict is displayed alongside the trade details — but you can always override and sign regardless.

---

## Polymarket Integration

Full end-to-end Polymarket trading via Ledger hardware wallet:

1. **Intent creation** — AI agent proposes a trade (market, outcome, amount)
2. **Enrichment** — Backend fetches market metadata (title, token IDs, prices)
3. **Simulation** — At sign time, fetches fresh price + tick size from the CLOB
4. **Signing** — Market info sent to Ledger, user reviews and confirms on device
5. **Submission** — Backend proxies the signed order to Polymarket's CLOB API
6. **Portfolio** — Positions tracked with sell support

---

## Quick Start

### Prerequisites

- Node.js 20+, pnpm 10+
- A Ledger device with the Polyledger app sideloaded

### Installation

```bash
git clone https://github.com/PoCInnovation/ethglobal2026.git
cd ethglobal2026
pnpm install
pnpm build --filter @agent-intents/shared
```

### Running

```bash
pnpm dev    # Starts backend (:3005) + web app (:5173)
```

### First Trade

1. Open `http://localhost:5173`, connect your Ledger
2. **Settings** > Connect to Polymarket (signs auth on Ledger)
3. **Settings** > Approve token allowances
4. Create a test intent via curl or wait for an AI agent to propose one
5. Review the council verdict, sign on your Ledger
6. Check the **Portfolio** tab

---

## Forked From

This project builds on [ledger-agent-intents](https://github.com/brackets-fistfulayen/ledger-agent-intents), which implemented the core intent queue + Ledger signing for ERC-20 transfers and x402 payments.

**What we added:**
- Custom Ledger device app with Polymarket market display
- Polymarket CLOB integration (order building, signing, submission, portfolio)
- Chainlink CRE oracle for decentralized market data verification
- AI council deliberation (Bull / Bear / Quant)
- NegRisk market support, tick-size rounding, backend CLOB proxy

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Device** | C (Ledger BOLOS SDK), custom APDU, TLV encoding |
| **Frontend** | React 19, TanStack Router/Query, Tailwind CSS, Ledger DMK |
| **Backend** | Express.js, TypeScript |
| **Oracle** | Chainlink CRE, Solidity |
| **Blockchain** | Polygon (Polymarket), Sepolia (Oracle) |
| **AI** | Multi-agent council, SSE streaming |
| **Monorepo** | pnpm workspaces + Turborepo |

---

## Team

**PoC Innovation**

| Member | GitHub |
|--------|--------|
| Lucas Leclerc | [@intermarch3](https://github.com/intermarch3) |
| Jules Lordet | [@l3yser](https://github.com/L3yserEpitech) |
| Gregoire Caseaux | [@Neketsu](https://github.com/Nezketsu) |
| Aurelien Demeusy | [@Aureliendemeusy](https://github.com/Aureliendemeusy) |

---

## License

MIT
