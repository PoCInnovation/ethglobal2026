import {
	bytesToHex,
	ConsensusAggregationByFields,
	encodeCallMsg,
	handler,
	EVMClient,
	HTTPCapability,
	HTTPClient,
	type HTTPSendRequester,
	type HTTPPayload,
	hexToBase64,
	getNetwork,
	identical,
	ignore,
	LAST_FINALIZED_BLOCK_NUMBER,
	median,
	Runner,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { type Address, decodeFunctionResult, encodeFunctionData, zeroAddress } from 'viem'
import { z } from 'zod'
import { PolymarketOracleABI } from '../contracts/abi/PolymarketOracle'

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com/markets'
const CLOB_API_BASE = 'https://clob.polymarket.com/markets'

const configSchema = z.object({
	oracleAddress: z.string(),
	chainSelectorName: z.string(),
	gasLimit: z.string(),
})

type Config = z.infer<typeof configSchema>

interface MarketInfo {
	conditionId: string
	question: string
	endDate: string
	active: boolean
	tokenId: string      // Yes outcome token ID (big uint256 as decimal string)
	negRisk: boolean     // Whether market uses negRisk CTF Exchange
	tickSize: number     // Tick size in basis points (100 = 0.01, 10 = 0.001)
}

interface OnChainMarket {
	conditionId: string
	question: string
	endDate: bigint
	active: boolean
	tokenId: bigint
	negRisk: boolean
	tickSize: bigint
	lastUpdate: bigint
}

// Consensus result: count + serialized market data that all DON nodes must agree on
interface MarketsFetchResult {
	count: number
	marketsJson: string // deterministic JSON — consensus via `identical` ensures all nodes agree
	debugLog: string // per-market source comparison, ignored in consensus
}

// Input payload from the HTTP trigger
interface TriggerInput {
	marketIds: number[]
}

// ---------------------------------------------------------------------------
// Step 1: Read on-chain state — which markets already exist in the oracle
// ---------------------------------------------------------------------------
const readOnChainMarkets = (
	runtime: Runtime<Config>,
	evmClient: EVMClient,
	conditionIds: string[],
): Map<string, OnChainMarket> => {
	const { oracleAddress } = runtime.config
	const existing = new Map<string, OnChainMarket>()

	for (const cid of conditionIds) {
		const callData = encodeFunctionData({
			abi: PolymarketOracleABI,
			functionName: 'getMarket',
			args: [cid as `0x${string}`],
		})

		const resp = evmClient
			.callContract(runtime, {
				call: encodeCallMsg({
					from: zeroAddress,
					to: oracleAddress as Address,
					data: callData,
				}),
				blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
			})
			.result()

		const returnData = bytesToHex(resp.data)
		if (!returnData || returnData === '0x') continue

		const raw = decodeFunctionResult({
			abi: PolymarketOracleABI,
			functionName: 'getMarket',
			data: returnData as `0x${string}`,
		})

		// decodeFunctionResult returns the single output directly (the tuple)
		const decoded = (raw as any)
		const lastUpdate = BigInt(decoded.lastUpdate ?? decoded[4] ?? 0)

		// lastUpdate == 0 means market doesn't exist on-chain yet
		if (lastUpdate === 0n) continue

		existing.set(cid, {
			conditionId: decoded.conditionId ?? decoded[0],
			question: decoded.question ?? decoded[1],
			endDate: BigInt(decoded.endDate ?? decoded[2] ?? 0),
			active: decoded.active ?? decoded[3],
			tokenId: BigInt(decoded.tokenId ?? decoded[4] ?? 0),
			negRisk: decoded.negRisk ?? decoded[5] ?? false,
			tickSize: BigInt(decoded.tickSize ?? decoded[6] ?? 0),
			lastUpdate: BigInt(decoded.lastUpdate ?? decoded[7] ?? 0),
		})
	}

	return existing
}

// ---------------------------------------------------------------------------
// Step 2: Fetch from APIs with dual-source validation
// ---------------------------------------------------------------------------
const fetchMarkets = (sendRequester: HTTPSendRequester, marketIds: number[]): MarketsFetchResult => {
	const markets: MarketInfo[] = []
	const logs: string[] = []

	// Sort market IDs for deterministic ordering across all DON nodes
	const sortedIds = [...marketIds].sort((a, b) => a - b)

	for (const id of sortedIds) {
		// --- Source 1: Gamma API ---
		const gammaUrl = `${GAMMA_API_BASE}/${id}`
		const gammaResp = sendRequester.sendRequest({ method: 'GET', url: gammaUrl }).result()

		if (gammaResp.statusCode === 404) { logs.push(`[${id}] Gamma: 404 (skipped)`); continue }
		if (gammaResp.statusCode !== 200) {
			throw new Error(`Gamma API failed for market ${id}: ${gammaResp.statusCode}`)
		}

		const gamma = JSON.parse(Buffer.from(gammaResp.body).toString('utf-8'))
		if (!gamma.conditionId) { logs.push(`[${id}] Gamma: no conditionId (skipped)`); continue }

		logs.push(`[${id}] Gamma: conditionId=${gamma.conditionId}, question="${gamma.question}", endDate=${gamma.endDate}, active=${gamma.active}`)

		// --- Source 2: CLOB API ---
		const clobUrl = `${CLOB_API_BASE}/${gamma.conditionId}`
		const clobResp = sendRequester.sendRequest({ method: 'GET', url: clobUrl }).result()

		if (clobResp.statusCode === 404) { logs.push(`[${id}] CLOB: 404 (skipped)`); continue }
		if (clobResp.statusCode !== 200) {
			throw new Error(`CLOB API failed for condition ${gamma.conditionId}: ${clobResp.statusCode}`)
		}

		const clob = JSON.parse(Buffer.from(clobResp.body).toString('utf-8'))

		logs.push(`[${id}] CLOB:  conditionId=${clob.condition_id}, question="${clob.question}", endDate=${clob.end_date_iso}, active=${clob.active}`)

		// --- Cross-source validation ---
		if (clob.condition_id !== gamma.conditionId) {
			throw new Error(`Source mismatch for market ${id}: conditionId differs (gamma=${gamma.conditionId}, clob=${clob.condition_id})`)
		}
		if (clob.question !== gamma.question) {
			throw new Error(`Source mismatch for market ${id}: question differs`)
		}

		// Compare date only (day precision) — Gamma and CLOB may differ on time-of-day
		const gammaDate = gamma.endDate.split('T')[0]
		const clobDate = clob.end_date_iso.split('T')[0]
		if (gammaDate !== clobDate) {
			throw new Error(`Source mismatch for market ${id}: endDate differs (gamma=${gamma.endDate}, clob=${clob.end_date_iso})`)
		}
		if (clob.active !== gamma.active) {
			throw new Error(`Source mismatch for market ${id}: active differs (gamma=${gamma.active}, clob=${clob.active})`)
		}

		logs.push(`[${id}] ✓ Cross-source validated`)

		// Extract trade-specific fields from CLOB response
		const tokens: Array<{ token_id: string; outcome: string }> = clob.tokens ?? []
		const yesToken = tokens.find((t) => t.outcome === 'Yes') ?? tokens[0]
		const resolvedTokenId = yesToken?.token_id ?? ''
		const negRisk: boolean = clob.neg_risk ?? false
		const rawTickSize: string = clob.minimum_tick_size ?? '0.01'
		// Convert tick size string to basis points: "0.01" → 100, "0.001" → 10, "0.0001" → 1
		const tickSizeBps = Math.round(parseFloat(rawTickSize) * 10000)

		logs.push(`[${id}] Trade fields: tokenId=${resolvedTokenId.slice(0, 20)}..., negRisk=${negRisk}, tickSize=${rawTickSize} (${tickSizeBps}bps)`)

		markets.push({
			conditionId: gamma.conditionId,
			question: gamma.question,
			endDate: gamma.endDate,
			active: gamma.active,
			tokenId: resolvedTokenId,
			negRisk,
			tickSize: tickSizeBps,
		})
	}

	// Deterministic serialization: sorted by conditionId
	const sorted = markets.sort((a, b) => a.conditionId.localeCompare(b.conditionId))
	const marketsJson = JSON.stringify(sorted)

	return { count: markets.length, marketsJson, debugLog: logs.join('\n') }
}

// ---------------------------------------------------------------------------
// Step 3: Compute delta — only markets that are new or changed
// ---------------------------------------------------------------------------
const computeDelta = (
	fetched: MarketInfo[],
	onChain: Map<string, OnChainMarket>,
): MarketInfo[] => {
	const delta: MarketInfo[] = []

	for (const m of fetched) {
		const existing = onChain.get(m.conditionId)

		if (!existing) {
			// New market — not on-chain yet
			delta.push(m)
			continue
		}

		// Check if any field changed
		const endDateUnix = BigInt(Math.floor(new Date(m.endDate).getTime() / 1000))
		const tokenIdBig = BigInt(m.tokenId || '0')
		const tickSizeBig = BigInt(m.tickSize)
		if (
			existing.question !== m.question ||
			existing.endDate !== endDateUnix ||
			existing.active !== m.active ||
			existing.tokenId !== tokenIdBig ||
			existing.negRisk !== m.negRisk ||
			existing.tickSize !== tickSizeBig
		) {
			delta.push(m)
		}
	}

	return delta
}

// ---------------------------------------------------------------------------
// Step 4: Write delta on-chain
// ---------------------------------------------------------------------------
const writeMarketsOnChain = (runtime: Runtime<Config>, evmClient: EVMClient, markets: MarketInfo[]): string => {
	const { oracleAddress, gasLimit } = runtime.config

	const callData = encodeFunctionData({
		abi: PolymarketOracleABI,
		functionName: 'updateMarkets',
		args: [
			markets.map((m) => ({
				conditionId: m.conditionId as `0x${string}`,
				question: m.question,
				endDate: BigInt(Math.floor(new Date(m.endDate).getTime() / 1000)),
				active: m.active,
				tokenId: BigInt(m.tokenId || '0'),
				negRisk: m.negRisk,
				tickSize: BigInt(m.tickSize),
			})),
		],
	})

	const reportResponse = runtime
		.report({
			encodedPayload: hexToBase64(callData),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	const resp = evmClient
		.writeReport(runtime, {
			receiver: oracleAddress as Address,
			report: reportResponse,
			gasConfig: { gasLimit },
		})
		.result()

	if (resp.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`writeReport failed: ${resp.errorMessage ?? resp.txStatus}`)
	}

	const txHash = bytesToHex(resp.txHash ?? new Uint8Array(32))
	return txHash
}

// ---------------------------------------------------------------------------
// Handler: orchestrates the 4-step pipeline
// ---------------------------------------------------------------------------
const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
	const inputJson = Buffer.from(payload.input).toString('utf-8')
	const input: TriggerInput = JSON.parse(inputJson)

	runtime.log(`Received request for ${input.marketIds.length} markets: ${input.marketIds.join(', ')}`)

	const { chainSelectorName } = runtime.config
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`Network not found: ${chainSelectorName}`)
	const evmClient = new EVMClient(network.chainSelector.selector)

	// --- Step 1: Fetch from APIs with dual-source validation + consensus ---
	runtime.log(`[Step 1] Fetching markets from Gamma + CLOB APIs...`)

	const httpCapability = new HTTPClient()
	const result = httpCapability
		.sendRequest(
			runtime,
			fetchMarkets,
			ConsensusAggregationByFields<MarketsFetchResult>({
				count: median,
				marketsJson: identical,
				debugLog: ignore,
			}),
		)(input.marketIds)
		.result()

	runtime.log(result.debugLog ?? '(debug log not available after consensus)')

	const fetched: MarketInfo[] = JSON.parse(result.marketsJson)
	runtime.log(`[Step 1] ${fetched.length} markets fetched and cross-source validated`)

	if (fetched.length === 0) {
		runtime.log('No markets to process — done')
		return '0x'
	}

	// --- Step 2: Read current on-chain state ---
	runtime.log(`[Step 2] Reading on-chain oracle state...`)

	const conditionIds = fetched.map((m) => m.conditionId)
	const onChain = readOnChainMarkets(runtime, evmClient, conditionIds)
	runtime.log(`[Step 2] ${onChain.size} markets already on-chain`)

	// --- Step 3: Compute delta ---
	const delta = computeDelta(fetched, onChain)
	runtime.log(`[Step 3] Delta: ${delta.length} new/changed markets out of ${fetched.length}`)

	if (delta.length === 0) {
		runtime.log('All markets up-to-date — no write needed')
		return '0x'
	}

	for (const m of delta) {
		const status = onChain.has(m.conditionId) ? 'UPDATED' : 'NEW'
		runtime.log(`  ${status}: "${m.question}" (${m.conditionId.slice(0, 10)}...)`)
	}

	// --- Step 4: Write only the delta on-chain ---
	runtime.log(`[Step 4] Writing ${delta.length} markets on-chain...`)
	const txHash = writeMarketsOnChain(runtime, evmClient, delta)
	runtime.log(`[Step 4] Done — tx: ${txHash}`)

	return txHash
}

const initWorkflow = (config: Config) => {
	const httpTrigger = new HTTPCapability()

	return [
		handler(
			httpTrigger.trigger({
				authorizedKeys: [],
			}),
			onHttpTrigger,
		),
	]
}

export async function main() {
	const runner = await Runner.newRunner<Config>({
		configSchema,
	})
	await runner.run(initWorkflow)
}
