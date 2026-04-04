/**
 * Build a Polymarket CLOB Order EIP-712 typed data from intent details.
 */

import type { PolymarketTradeDetails } from "@agent-intents/shared";

const ORDER_DOMAIN = {
	name: "ClobAuthDomain",
	version: "1",
	chainId: 137,
} as const;

const ORDER_TYPES = {
	EIP712Domain: [
		{ name: "name", type: "string" },
		{ name: "version", type: "string" },
		{ name: "chainId", type: "uint256" },
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

/**
 * Build EIP-712 typed data for a Polymarket order from intent details.
 *
 * @param details - The enriched polymarket trade intent (must have tokenId)
 * @param walletAddress - The connected Ledger wallet address (maker/signer)
 * @returns EIP-712 typed data ready for signTypedDataV4
 */
export function buildOrderFromIntent(details: PolymarketTradeDetails, walletAddress: string) {
	if (!details.tokenId) {
		throw new Error("Intent is missing tokenId — market data not enriched");
	}

	const amount = Number.parseFloat(details.amount);
	if (Number.isNaN(amount) || amount <= 0) {
		throw new Error(`Invalid amount: ${details.amount}`);
	}

	// USDC has 6 decimals
	const usdcAtomic = BigInt(Math.round(amount * 1_000_000));

	// Compute shares from price: shares = usdc / price
	// Both amounts are in USDC atomic units (6 decimals)
	const price = details.outcomePrice ?? 0.5; // fallback to 0.5 if no price
	const sharesAtomic = BigInt(Math.round(amount / price * 1_000_000));

	// BUY: maker pays USDC (makerAmount), receives shares (takerAmount)
	// SELL: maker pays shares (makerAmount), receives USDC (takerAmount)
	const side = 0; // BUY for now (agent always buys outcome tokens)
	const makerAmount = side === 0 ? usdcAtomic.toString() : sharesAtomic.toString();
	const takerAmount = side === 0 ? sharesAtomic.toString() : usdcAtomic.toString();

	const salt = String(Math.floor(Math.random() * 1_000_000_000));

	return {
		domain: { ...ORDER_DOMAIN },
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
			expiration: "0", // no expiration
			nonce: "0",
			feeRateBps: "0",
			side: String(side),
			signatureType: "0", // EOA
		},
	};
}
