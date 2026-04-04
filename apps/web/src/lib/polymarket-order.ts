/**
 * Build a Polymarket CLOB Order EIP-712 typed data from intent details.
 *
 * Uses the correct "Polymarket CTF Exchange" domain (NOT "ClobAuthDomain")
 * with the appropriate verifyingContract based on negRisk.
 */

import type { PolymarketTradeDetails } from "@agent-intents/shared";

const API_BASE = "";

// Exchange contract addresses on Polygon mainnet
const CTF_EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_CTF_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";

const ORDER_TYPES = {
	EIP712Domain: [
		{ name: "name", type: "string" },
		{ name: "version", type: "string" },
		{ name: "chainId", type: "uint256" },
		{ name: "verifyingContract", type: "address" },
	],
	Order: [
		{ name: "salt", type: "uint256" },
		{ name: "maker", type: "address" },
		{ name: "signer", type: "address" },
		{ name: "taker", type: "address" },
		{ name: "tokenId", type: "uint256" },
		{ name: "makerAmount", type: "uint256" },
		{ name: "takerAmount", type: "uint256" },
		{ name: "expiration", type: "uint256" },
		{ name: "nonce", type: "uint256" },
		{ name: "feeRateBps", type: "uint256" },
		{ name: "side", type: "uint8" },
		{ name: "signatureType", type: "uint8" },
	],
} as const;

export interface SimulationResult {
	tokenId: string;
	question: string;
	outcome: string;
	price: number;
	negRisk: boolean;
	tickSize: string;
}

/**
 * Fetch latest price + market info from backend (calls Gamma API).
 * This is the "simulation" step before signing.
 */
export async function simulateOrder(tokenId: string): Promise<SimulationResult> {
	console.log("[Order] Simulating order for tokenId:", tokenId);
	const res = await fetch(`${API_BASE}/api/polymarket/simulate?tokenId=${tokenId}`);
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.error || `Simulation failed: ${res.status}`);
	}
	const data = await res.json();
	console.log("[Order] Simulation result:", data);
	return data;
}

/**
 * Round a number down to the given number of decimal places.
 */
function roundDown(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.floor(value * factor) / factor;
}

/**
 * Get rounding config from tick size.
 */
function getRoundConfig(tickSize: string): { price: number; size: number; amount: number } {
	switch (tickSize) {
		case "0.1": return { price: 1, size: 2, amount: 3 };
		case "0.01": return { price: 2, size: 2, amount: 4 };
		case "0.001": return { price: 3, size: 2, amount: 5 };
		case "0.0001": return { price: 4, size: 2, amount: 6 };
		default: return { price: 2, size: 2, amount: 4 };
	}
}

/**
 * Build EIP-712 typed data for a Polymarket order from intent details.
 *
 * @param details - The enriched polymarket trade intent (must have tokenId)
 * @param walletAddress - The connected Ledger wallet address (maker/signer)
 * @param simulation - Fresh simulation result with current price and negRisk
 * @returns EIP-712 typed data ready for signTypedDataV4
 */
export function buildOrderFromIntent(
	details: PolymarketTradeDetails,
	walletAddress: string,
	simulation: SimulationResult,
) {
	if (!details.tokenId) {
		throw new Error("Intent is missing tokenId — market data not enriched");
	}

	const amount = Number.parseFloat(details.amount);
	if (Number.isNaN(amount) || amount <= 0) {
		throw new Error(`Invalid amount: ${details.amount}`);
	}

	const rawPrice = simulation.price;
	if (rawPrice <= 0 || rawPrice >= 1) {
		throw new Error(`Invalid price from simulation: ${rawPrice}`);
	}

	const roundConfig = getRoundConfig(simulation.tickSize);

	// Round price to tick size FIRST (e.g., 0.0075 with tick 0.001 → 0.008 for BUY)
	const tickSize = Number.parseFloat(simulation.tickSize);
	// For BUY, round UP to nearest tick to be more aggressive (ensure fill)
	const ticks = Math.ceil(rawPrice / tickSize);
	// Use toFixed to eliminate floating point artifacts (e.g., 0.008000000000001)
	const priceRounded = Number((ticks * tickSize).toFixed(roundConfig.price));

	// BUY: maker pays USDC (makerAmount), receives shares (takerAmount)
	const side = 0; // BUY (agent always buys outcome tokens)

	// Compute size (shares) and amounts following Polymarket SDK logic
	// For BUY: takerAmount = shares, makerAmount = shares * price
	const rawSize = roundDown(amount / priceRounded, roundConfig.size);
	const rawTakerAmt = roundDown(rawSize, roundConfig.amount); // shares to receive
	const rawMakerAmt = roundDown(rawTakerAmt * priceRounded, roundConfig.amount); // USDC to pay

	// Convert to atomic units (6 decimals for USDC and conditional tokens)
	const makerAmount = BigInt(Math.round(rawMakerAmt * 1_000_000)).toString();
	const takerAmount = BigInt(Math.round(rawTakerAmt * 1_000_000)).toString();

	// Salt: random * timestamp for uniqueness (matches Polymarket SDK)
	const salt = String(Math.round(Math.random() * Date.now()));

	// Pick the correct exchange contract based on negRisk
	const verifyingContract = simulation.negRisk ? NEG_RISK_CTF_EXCHANGE : CTF_EXCHANGE;

	console.log("[Order] Building order:", {
		side: "BUY",
		rawPrice,
		priceRounded,
		rawSize,
		rawMakerAmt,
		rawTakerAmt,
		makerAmount,
		takerAmount,
		negRisk: simulation.negRisk,
		verifyingContract,
		tickSize: simulation.tickSize,
	});

	return {
		domain: {
			name: "Polymarket CTF Exchange",
			version: "1",
			chainId: 137,
			verifyingContract,
		},
		primaryType: "Order" as const,
		types: { ...ORDER_TYPES },
		message: {
			salt,
			maker: walletAddress,
			signer: walletAddress,
			taker: "0x0000000000000000000000000000000000000000",
			tokenId: details.tokenId,
			makerAmount,
			takerAmount,
			expiration: "0", // no expiration (GTC)
			nonce: "0",
			feeRateBps: "0",
			side: String(side),
			signatureType: "0", // EOA
		},
	};
}
