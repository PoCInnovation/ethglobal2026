/**
 * Polymarket CLOB Order helpers — builds EIP-712 typed data for signing
 * via signTypedDataV4 (Ledger Polymarket app + MCP clear signing).
 */

import type { PolymarketTradeDetails } from "@agent-intents/shared";
import { POLYMARKET_CONFIG } from "@agent-intents/shared";
import { parseUnits } from "viem";

const POLYMARKET_ORDER_TYPES = {
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

function randomSalt(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return BigInt(
		`0x${Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("")}`,
	).toString();
}

/**
 * Build EIP-712 typed data for a Polymarket CLOB Order.
 * Requires `tokenId` from the enriched intent details.
 */
export function buildPolymarketOrderTypedData(
	details: PolymarketTradeDetails,
	makerAddress: string,
) {
	if (!details.tokenId) {
		throw new Error("tokenId is required to build a Polymarket order — was the intent enriched?");
	}

	const usdcAtomicAmount = parseUnits(details.amount, 6);
	const price = details.outcomePrice ?? 0.5;
	const takerAmount = BigInt(Math.floor(Number(usdcAtomicAmount) / price));

	const expirationSec = Math.floor(Date.now() / 1000) + 86400; // 24h

	const domain = {
		name: "ClobExchange",
		version: "1",
		chainId: POLYMARKET_CONFIG.CHAIN_ID,
		verifyingContract: POLYMARKET_CONFIG.CTF_EXCHANGE,
	};

	const message = {
		salt: randomSalt(),
		maker: makerAddress,
		signer: makerAddress,
		taker: "0x0000000000000000000000000000000000000000",
		tokenId: details.tokenId,
		makerAmount: usdcAtomicAmount.toString(),
		takerAmount: takerAmount.toString(),
		expiration: String(expirationSec),
		nonce: "0",
		feeRateBps: "0",
		side: details.outcome === "Yes" ? 0 : 1,
		signatureType: 0,
	};

	return {
		types: POLYMARKET_ORDER_TYPES,
		primaryType: "Order" as const,
		domain,
		message,
	};
}
