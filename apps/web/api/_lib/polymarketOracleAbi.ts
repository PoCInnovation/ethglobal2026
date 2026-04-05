/**
 * ABI for the PolymarketOracle contract deployed on Sepolia.
 * Mirrors apps/CRE/contracts/abi/PolymarketOracle.ts — kept here to avoid
 * cross-package import issues at Vercel build time.
 */
/**
 * ABI for the PolymarketOracle contract deployed on Sepolia.
 * Mirrors apps/CRE/contracts/abi/PolymarketOracle.ts — kept here to avoid
 * cross-package import issues at Vercel build time.
 */
export const PolymarketOracleABI = [
	{
		name: "getMarket",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "conditionId", type: "bytes32" }],
		outputs: [
			{
				name: "",
				type: "tuple",
				components: [
					{ name: "conditionId", type: "bytes32" },
					{ name: "question", type: "string" },
					{ name: "endDate", type: "uint256" },
					{ name: "active", type: "bool" },
					{ name: "tokenId", type: "uint256" },
					{ name: "negRisk", type: "bool" },
					{ name: "tickSize", type: "uint256" },
					{ name: "lastUpdate", type: "uint256" },
				],
			},
		],
	},
	{
		name: "updateMarkets",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{
				name: "markets",
				type: "tuple[]",
				components: [
					{ name: "conditionId", type: "bytes32" },
					{ name: "question", type: "string" },
					{ name: "endDate", type: "uint256" },
					{ name: "active", type: "bool" },
					{ name: "tokenId", type: "uint256" },
					{ name: "negRisk", type: "bool" },
					{ name: "tickSize", type: "uint256" },
				],
			},
		],
		outputs: [],
	},
	{
		name: "totalMarkets",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ name: "", type: "uint256" }],
	},
] as const;
