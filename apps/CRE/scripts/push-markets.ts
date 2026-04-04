#!/usr/bin/env bun
/**
 * push-markets.ts
 *
 * Fetches Polymarket market data from Gamma API and writes it on-chain
 * by calling updateMarketsDirect() on the PolymarketOracle contract.
 *
 * Usage:
 *   cd apps/CRE/polymarket-info && bun run ../scripts/push-markets.ts --market-ids 12,1850947
 *
 * Env vars (in apps/CRE/.env):
 *   CRE_ETH_PRIVATE_KEY  — deployer/admin private key
 *   ORACLE_ADDRESS        — deployed PolymarketOracle address
 *   RPC_URL               — (optional) defaults to Sepolia public RPC
 */
import { createPublicClient, createWalletClient, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const PolymarketOracleABI = [
	{
		name: 'updateMarketsDirect',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [
			{
				name: 'incoming',
				type: 'tuple[]',
				components: [
					{ name: 'conditionId', type: 'bytes32' },
					{ name: 'question', type: 'string' },
					{ name: 'endDate', type: 'uint256' },
					{ name: 'active', type: 'bool' },
					{ name: 'lastUpdate', type: 'uint256' },
				],
			},
		],
		outputs: [],
	},
	{
		name: 'getMarket',
		type: 'function',
		stateMutability: 'view',
		inputs: [{ name: 'conditionId', type: 'bytes32' }],
		outputs: [
			{
				name: '',
				type: 'tuple',
				components: [
					{ name: 'conditionId', type: 'bytes32' },
					{ name: 'question', type: 'string' },
					{ name: 'endDate', type: 'uint256' },
					{ name: 'active', type: 'bool' },
					{ name: 'lastUpdate', type: 'uint256' },
				],
			},
		],
	},
	{
		name: 'totalMarkets',
		type: 'function',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'uint256' }],
	},
] as const

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com/markets'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const rawKey = process.env.CRE_ETH_PRIVATE_KEY ?? ''
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`
const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS as Address
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'

if (!PRIVATE_KEY || PRIVATE_KEY === 'your-eth-private-key') {
	console.error('Set CRE_ETH_PRIVATE_KEY in apps/CRE/.env')
	process.exit(1)
}
if (!ORACLE_ADDRESS) {
	console.error('Set ORACLE_ADDRESS in apps/CRE/.env')
	process.exit(1)
}

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------
const marketIdsArg = process.argv.find((a) => a.startsWith('--market-ids='))?.split('=')[1]
	?? process.argv[process.argv.indexOf('--market-ids') + 1]

if (!marketIdsArg) {
	console.error('Usage: bun run push-markets.ts --market-ids 12,1850947')
	process.exit(1)
}

const marketIds = marketIdsArg.split(',').map(Number)

// ---------------------------------------------------------------------------
// Fetch markets from Gamma API
// ---------------------------------------------------------------------------
interface MarketData {
	conditionId: `0x${string}`
	question: string
	endDate: string
	active: boolean
}

async function fetchMarkets(ids: number[]): Promise<MarketData[]> {
	const markets: MarketData[] = []

	for (const id of ids) {
		const res = await fetch(`${GAMMA_API_BASE}/${id}`)
		if (res.status === 404) {
			console.log(`  Market ${id}: not found, skipping`)
			continue
		}
		if (!res.ok) throw new Error(`HTTP ${res.status} for market ${id}`)

		const m = await res.json()
		if (!m.conditionId) {
			console.log(`  Market ${id}: no conditionId, skipping`)
			continue
		}

		markets.push({
			conditionId: m.conditionId as `0x${string}`,
			question: m.question,
			endDate: m.endDate,
			active: m.active,
		})
		console.log(`  Market ${id}: "${m.question}" (${m.active ? 'active' : 'inactive'})`)
	}

	return markets
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
	console.log(`Fetching ${marketIds.length} markets from Gamma API...`)
	const markets = await fetchMarkets(marketIds)

	if (markets.length === 0) {
		console.log('No valid markets to push.')
		return
	}

	console.log(`\nPushing ${markets.length} markets on-chain to ${ORACLE_ADDRESS}...`)

	const account = privateKeyToAccount(PRIVATE_KEY)
	const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) })
	const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) })

	const args = markets.map((m) => ({
		conditionId: m.conditionId,
		question: m.question,
		endDate: BigInt(Math.floor(new Date(m.endDate).getTime() / 1000)),
		active: m.active,
		lastUpdate: 0n, // will be overridden by contract (block.timestamp)
	}))

	const hash = await walletClient.writeContract({
		address: ORACLE_ADDRESS,
		abi: PolymarketOracleABI,
		functionName: 'updateMarketsDirect',
		args: [args],
	})

	console.log(`\nTx submitted: ${hash}`)
	console.log('Waiting for confirmation...')

	const receipt = await publicClient.waitForTransactionReceipt({ hash })
	console.log(`Confirmed in block ${receipt.blockNumber} (status: ${receipt.status})`)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
