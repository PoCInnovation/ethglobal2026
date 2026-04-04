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
	const url = `${POLYMARKET_CONFIG.GAMMA_API_BASE}/markets?condition_id=${conditionId}&limit=1`;
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

		const lastUpdate = BigInt(decoded.lastUpdate ?? decoded[4] ?? 0);
		if (lastUpdate === 0n) return null;

		return {
			conditionId: decoded.conditionId ?? decoded[0],
			question: decoded.question ?? decoded[1],
			endDate: BigInt(decoded.endDate ?? decoded[2] ?? 0),
			active: decoded.active ?? decoded[3],
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
	source: "on-chain" | "gamma-fallback";
}

export async function fetchVerifiedMarketForSigning(
	conditionId: string,
): Promise<VerifiedMarketData> {
	const isOracleDeployed =
		ORACLE_ADDRESS !== "0x0000000000000000000000000000000000000000";

	if (!isOracleDeployed) {
		logger.warn({ conditionId }, "Oracle not deployed — falling back to Gamma");
		return fetchGammaFallback(conditionId);
	}

	// Step 1: Resolve Gamma numeric marketId
	const marketId = await resolveGammaMarketId(conditionId);
	if (!marketId) {
		logger.warn({ conditionId }, "Could not resolve Gamma marketId — falling back to Gamma");
		return fetchGammaFallback(conditionId);
	}

	// Step 2: Run CRE simulation (writes on-chain, waits for completion ~1-2s)
	try {
		await runCRESimulation([marketId]);
	} catch (err) {
		logger.error({ err, conditionId, marketId }, "CRE simulation failed — falling back to Gamma");
		return fetchGammaFallback(conditionId);
	}

	// Step 3: Read fresh on-chain data
	const onChain = await readOnChainMarket(conditionId);
	if (onChain) {
		logger.info({ conditionId, question: onChain.question, source: "on-chain" }, "CRE-verified market data ready");
		return {
			conditionId: onChain.conditionId,
			question: onChain.question,
			endDate: Number(onChain.endDate),
			active: onChain.active,
			source: "on-chain",
		};
	}

	// Step 4: Gamma fallback (shouldn't happen if simulation succeeded)
	logger.warn({ conditionId }, "On-chain read returned empty after simulation — falling back to Gamma");
	return fetchGammaFallback(conditionId);
}

async function fetchGammaFallback(conditionId: string): Promise<VerifiedMarketData> {
	const url = `${POLYMARKET_CONFIG.CLOB_API_BASE}/markets/${conditionId}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Cannot fetch market data for ${conditionId}`);
	const m = await res.json();
	return {
		conditionId,
		question: m.question,
		endDate: m.end_date_iso ? Math.floor(new Date(m.end_date_iso).getTime() / 1000) : 0,
		active: m.active ?? false,
		source: "gamma-fallback",
	};
}
