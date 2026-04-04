import {
	bytesToHex,
	ConsensusAggregationByFields,
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
	median,
	Runner,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { type Address, encodeFunctionData } from 'viem'
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

		markets.push({
			conditionId: gamma.conditionId,
			question: gamma.question,
			endDate: gamma.endDate,
			active: gamma.active,
		})
	}

	// Deterministic serialization: sorted by conditionId
	const sorted = markets.sort((a, b) => a.conditionId.localeCompare(b.conditionId))
	const marketsJson = JSON.stringify(sorted)

	return { count: markets.length, marketsJson, debugLog: logs.join('\n') }
}

const writeMarketsOnChain = (runtime: Runtime<Config>, markets: MarketInfo[]): string => {
	const { oracleAddress, chainSelectorName, gasLimit } = runtime.config

	const network = getNetwork({
		chainFamily: 'evm',
		chainSelectorName,
		isTestnet: true,
	})

	if (!network) {
		throw new Error(`Network not found for chain selector: ${chainSelectorName}`)
	}

	const evmClient = new EVMClient(network.chainSelector.selector)

	const callData = encodeFunctionData({
		abi: PolymarketOracleABI,
		functionName: 'updateMarkets',
		args: [
			markets.map((m) => ({
				conditionId: m.conditionId as `0x${string}`,
				question: m.question,
				endDate: BigInt(Math.floor(new Date(m.endDate).getTime() / 1000)),
				active: m.active,
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
	runtime.log(`Markets written on-chain: ${txHash}`)

	return txHash
}

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
	const inputJson = Buffer.from(payload.input).toString('utf-8')
	const input: TriggerInput = JSON.parse(inputJson)

	runtime.log(`Received request for ${input.marketIds.length} markets: ${input.marketIds.join(', ')}`)

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

	// Log per-source comparison
	runtime.log(`--- Source comparison ---`)
	runtime.log(result.debugLog ?? '(no debug log — field ignored in consensus)')

	// Parse markets from consensus-verified JSON — all DON nodes agreed on this data
	const markets: MarketInfo[] = JSON.parse(result.marketsJson)

	runtime.log(`--- Consensus result (${result.count} markets) ---`)
	runtime.log(JSON.stringify(markets, null, 2))

	const txHash = writeMarketsOnChain(runtime, markets)

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
