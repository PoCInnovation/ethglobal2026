/**
 * Polymarket transaction helpers — ABI for PolyProxy and tx builder.
 */

import type { PolymarketTradeDetails } from "@agent-intents/shared";
import { POLYMARKET_CONFIG } from "@agent-intents/shared";
import { encodeFunctionData, parseUnits } from "viem";

function getPolyProxyAddress(): `0x${string}` {
	const envAddr = import.meta.env.VITE_POLY_PROXY_ADDRESS as string | undefined;
	return (envAddr?.startsWith("0x") ? envAddr : POLYMARKET_CONFIG.POLY_PROXY_ADDRESS) as `0x${string}`;
}

const POLY_PROXY_ABI = [
	{
		name: "placePolymarketOrder",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "conditionId", type: "bytes32" },
			{ name: "marketTitle", type: "string" },
			{ name: "outcome", type: "uint8" },
			{ name: "amount", type: "uint256" },
		],
		outputs: [],
	},
] as const;

export function buildPolymarketTx(details: PolymarketTradeDetails) {
	const data = encodeFunctionData({
		abi: POLY_PROXY_ABI,
		functionName: "placePolymarketOrder",
		args: [
			details.conditionId as `0x${string}`,
			details.marketTitle,
			details.outcome === "Yes" ? 0 : 1,
			parseUnits(details.amount, 6),
		],
	});

	return {
		to: getPolyProxyAddress(),
		data,
		value: "0x0" as const,
	};
}
