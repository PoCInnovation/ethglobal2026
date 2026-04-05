/**
 * Oracle CRE integration.
 *
 * Flow when a user signs a Polymarket trade:
 *   1. Resolve Gamma numeric marketId from conditionId
 *   2. Run `cre workflow simulate` as a subprocess (writes on-chain on Sepolia via --broadcast)
 *   3. Read getMarket(conditionId) from PolymarketOracle on Sepolia
 *   4. Return CRE-verified data (or Gamma fallback if read fails)
 */

import type { PolymarketTradeDetails } from "@agent-intents/shared";
import { POLYMARKET_CONFIG } from "@agent-intents/shared";
import { enrichPolymarketIntent as enrichViaGamma } from "./polymarketService.js";
import { logger } from "./logger.js";
import { createPublicClient, http, decodeFunctionResult, encodeFunctionData } from "viem";
import { sepolia } from "viem/chains";
import { PolymarketOracleABI } from "./polymarketOracleAbi.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ORACLE_ADDRESS = (
	process.env.ORACLE_CRE_ADDRESS?.startsWith("0x")
		? process.env.ORACLE_CRE_ADDRESS
		: POLYMARKET_CONFIG.ORACLE_CRE_ADDRESS
) as `0x${string}`;

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://rpc.ankr.com/eth_sepolia";

// Path to the CRE workflow directory (relative to this file at apps/web/api/_lib/)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRE_WORKFLOW_DIR = path.resolve(__dirname, "../../../../CRE/polymarket-info");
const CRE_BINARY = process.env.CRE_BINARY ?? "/usr/local/bin/cre";

// ---------------------------------------------------------------------------
// Step 1 — Resolve Gamma numeric market ID from conditionId
// ---------------------------------------------------------------------------

async function resolveGammaMarketId(conditionId: string): Promise<number | null> {
	const url = `${POLYMARKET_CONFIG.GAMMA_API_BASE}/markets?condition_ids=${conditionId}&limit=1`;
	const res = await fetch(url);
	if (!res.ok) return null;
	const markets = await res.json();
	const m = Array.isArray(markets) && markets.length > 0 ? markets[0] : null;
	if (!m?.id) return null;
	const id = Number(m.id);
	return Number.isFinite(id) ? id : null;
}

// ---------------------------------------------------------------------------
// Step 2 — Run CRE simulation (writes on-chain via --broadcast)
// ---------------------------------------------------------------------------

async function runCRESimulation(marketIds: number[]): Promise<void> {
	const payload = JSON.stringify({ marketIds });
	const args = [
		"workflow", "simulate", CRE_WORKFLOW_DIR,
		"--target", "staging-settings",
		"--trigger-index", "0",
		"--non-interactive",
		"--http-payload", payload,
		"--broadcast",
	];

	logger.info({ marketIds, cmd: `${CRE_BINARY} ${args.join(" ")}` }, "Running CRE simulation");

	const { stdout, stderr } = await execFileAsync(CRE_BINARY, args, {
		cwd: CRE_WORKFLOW_DIR,
		timeout: 60_000,
		env: {
			...process.env,
			PATH: `/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ""}`,
		},
	});

	logger.info({ marketIds, stdout: stdout.slice(0, 500) }, "CRE simulation completed");
	if (stderr) logger.debug({ stderr: stderr.slice(0, 200) }, "CRE simulation stderr");
}

// ---------------------------------------------------------------------------
// Read getMarket from the Sepolia oracle contract (single call, no polling)
// ---------------------------------------------------------------------------

interface OnChainMarket {
	conditionId: string;
	question: string;
	endDate: bigint;
	active: boolean;
	tokenId: string;
	negRisk: boolean;
	tickSize: string; // decimal string e.g. "0.01"
	lastUpdate: bigint;
}

async function readOnChainMarket(conditionId: string): Promise<OnChainMarket | null> {
	const client = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });

	try {
		const data = encodeFunctionData({
			abi: PolymarketOracleABI,
			functionName: "getMarket",
			args: [conditionId as `0x${string}`],
		});

		const raw = await client.call({
			to: ORACLE_ADDRESS,
			data,
		});

		if (!raw.data || raw.data === "0x") return null;

		const decoded = decodeFunctionResult({
			abi: PolymarketOracleABI,
			functionName: "getMarket",
			data: raw.data,
		}) as any;

		const lastUpdate = BigInt(decoded.lastUpdate ?? decoded[7] ?? 0);
		if (lastUpdate === 0n) return null;

		// Convert tickSize from basis points (uint256) back to decimal string
		const tickSizeBps = Number(BigInt(decoded.tickSize ?? decoded[6] ?? 0));
		const tickSizeDecimal = tickSizeBps > 0 ? (tickSizeBps / 10000).toString() : "0.01";

		return {
			conditionId: decoded.conditionId ?? decoded[0],
			question: decoded.question ?? decoded[1],
			endDate: BigInt(decoded.endDate ?? decoded[2] ?? 0),
			active: decoded.active ?? decoded[3],
			tokenId: String(BigInt(decoded.tokenId ?? decoded[4] ?? 0)),
			negRisk: decoded.negRisk ?? decoded[5] ?? false,
			tickSize: tickSizeDecimal,
			lastUpdate,
		};
	} catch (err) {
		logger.warn({ err, conditionId }, "readOnChainMarket call failed");
		return null;
	}
}

// ---------------------------------------------------------------------------
// Public: verifyAndEnrichPolymarketIntent
//   Called during intent creation (POST /api/intents). Falls back to Gamma.
// ---------------------------------------------------------------------------

export async function verifyAndEnrichPolymarketIntent(
	details: PolymarketTradeDetails,
): Promise<PolymarketTradeDetails> {
	const isOracleDeployed =
		ORACLE_ADDRESS !== "0x0000000000000000000000000000000000000000";

	if (isOracleDeployed) {
		logger.debug({ conditionId: details.conditionId }, "Oracle CRE configured — checking on-chain");
		const onChain = await readOnChainMarket(details.conditionId);
		if (onChain) {
			logger.info({ conditionId: details.conditionId, question: onChain.question }, "Using on-chain market data for enrichment");
			// Still need tokenId + outcomePrice from Gamma — merge
			const gammaEnriched = await enrichViaGamma(details);
			return {
				...gammaEnriched,
				marketTitle: onChain.question,
			};
		}
		logger.warn({ conditionId: details.conditionId }, "Market not on-chain yet, falling back to Gamma");
	}

	return enrichViaGamma(details);
}

// ---------------------------------------------------------------------------
// Public: fetchVerifiedMarketForSigning
//   Called right before the user signs. Runs the full CRE pipeline:
//   1. Resolve Gamma marketId from conditionId
//   2. Run `cre workflow simulate --broadcast` → writes verified data on-chain
//   3. Read getMarket(conditionId) from the oracle contract
//   4. Return verified data (or Gamma fallback on any failure)
// ---------------------------------------------------------------------------

export interface VerifiedMarketData {
	conditionId: string;
	question: string;
	endDate: number; // Unix seconds
	active: boolean;
	tokenId: string;       // Token ID for the requested outcome
	negRisk: boolean;      // Whether market uses negRisk CTF Exchange
	tickSize: string;      // Decimal string e.g. "0.01"
	source: "on-chain" | "gamma-fallback";
}

export async function fetchVerifiedMarketForSigning(
	conditionId: string,
	outcome?: string,
): Promise<VerifiedMarketData> {
	const isOracleDeployed =
		ORACLE_ADDRESS !== "0x0000000000000000000000000000000000000000";

	if (!isOracleDeployed) {
		logger.warn({ conditionId }, "Oracle not deployed — falling back to Gamma");
		return fetchGammaFallback(conditionId, outcome);
	}

	const marketId = await resolveGammaMarketId(conditionId);
	if (!marketId) {
		logger.warn({ conditionId }, "Could not resolve Gamma marketId — falling back");
		return fetchGammaFallback(conditionId, outcome);
	}

	try {
		await runCRESimulation([marketId]);
	} catch (err) {
		logger.warn({ err, conditionId }, "CRE simulation failed — falling back to Gamma");
		return fetchGammaFallback(conditionId, outcome);
	}

	const onChain = await readOnChainMarket(conditionId);
	if (onChain) {
		// On-chain stores only the Yes tokenId — if outcome is No, fall back to Gamma for the correct tokenId
		if (outcome && outcome.toLowerCase() === "no") {
			logger.info({ conditionId }, "CRE on-chain: outcome is No, fetching No tokenId from Gamma");
			const gamma = await fetchGammaFallback(conditionId, outcome);
			return {
				...gamma,
				question: onChain.question,
				active: onChain.active,
				negRisk: onChain.negRisk,
				tickSize: onChain.tickSize,
				source: "on-chain",
			};
		}
		return {
			conditionId: onChain.conditionId,
			question: onChain.question,
			endDate: Number(onChain.endDate),
			active: onChain.active,
			tokenId: onChain.tokenId,
			negRisk: onChain.negRisk,
			tickSize: onChain.tickSize,
			source: "on-chain",
		};
	}

	logger.warn({ conditionId }, "CRE simulation ran but market not on-chain yet — falling back to Gamma");
	return fetchGammaFallback(conditionId, outcome);
}

async function fetchGammaFallback(conditionId: string, outcome?: string): Promise<VerifiedMarketData> {
	const url = `${POLYMARKET_CONFIG.CLOB_API_BASE}/markets/${conditionId}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Cannot fetch market data for ${conditionId}`);
	const m = await res.json();

	const tokens: Array<{ token_id: string; outcome: string }> = m.tokens ?? [];
	// Find the token matching the requested outcome; default to "Yes"
	const targetOutcome = outcome ?? "Yes";
	const token =
		tokens.find((t) => t.outcome.toLowerCase() === targetOutcome.toLowerCase()) ??
		tokens.find((t) => t.outcome === "Yes") ??
		tokens[0];

	return {
		conditionId,
		question: m.question,
		endDate: m.end_date_iso ? Math.floor(new Date(m.end_date_iso).getTime() / 1000) : 0,
		active: m.active ?? false,
		tokenId: token?.token_id ?? "",
		negRisk: m.neg_risk ?? false,
		tickSize: m.minimum_tick_size ?? "0.01",
		source: "gamma-fallback",
	};
}
