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
	median,
	Runner,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { type Address, encodeFunctionData } from 'viem'
import { z } from 'zod'
import { PolymarketOracleABI } from '../contracts/abi/PolymarketOracle'

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com/markets'

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

interface MarketsFetchResult {
	count: number
}

// Input payload from the HTTP trigger
interface TriggerInput {
	marketIds: number[]
}

// Module-level cache populated as a side effect of fetchMarkets
let cachedMarkets: MarketInfo[] = []

const fetchMarkets = (sendRequester: HTTPSendRequester, marketIds: number[]): MarketsFetchResult => {
	const markets: MarketInfo[] = []

	for (const id of marketIds) {
		const url = `${GAMMA_API_BASE}/${id}`
		const response = sendRequester.sendRequest({ method: 'GET', url }).result()

		if (response.statusCode === 404) continue // market not found, skip
		if (response.statusCode !== 200) {
			throw new Error(`HTTP request failed for market ${id}: ${response.statusCode}`)
		}

		const responseText = Buffer.from(response.body).toString('utf-8')
		const m = JSON.parse(responseText)

		if (!m.conditionId) continue // market not yet deployed on-chain

		markets.push({
			conditionId: m.conditionId,
			question: m.question,
			endDate: m.endDate,
			active: m.active,
		})
	}

	cachedMarkets = markets
	return { count: markets.length }
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
	// Decode the JSON input from the HTTP request
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
			}),
		)(input.marketIds)
		.result()

	const markets = cachedMarkets

	runtime.log(`Fetched ${result.count} markets, writing on-chain...`)
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
