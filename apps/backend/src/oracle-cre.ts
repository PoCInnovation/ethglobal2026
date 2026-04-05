/**
 * Oracle CRE integration for the Express backend.
 *
 * Flow when a user signs a Polymarket trade:
 *   1. Resolve Gamma numeric marketId from conditionId
 *   2. Run `cre workflow simulate --broadcast` (writes on-chain on Sepolia)
 *   3. Read getMarket(conditionId) from PolymarketOracle on Sepolia
 *   4. Return verified data (or Gamma CLOB API fallback on any failure)
 *
 * Mirrors apps/web/api/_lib/oracleCre.ts — kept separate to avoid
 * cross-package import issues.
 */

import { createPublicClient, http, decodeFunctionResult, encodeFunctionData } from "viem";
import { sepolia } from "viem/chains";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

function getOracleAddress(): `0x${string}` {
	const addr = process.env.ORACLE_CRE_ADDRESS;
	return (addr?.startsWith("0x") ? addr : "0x0000000000000000000000000000000000000000") as `0x${string}`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRE_WORKFLOW_DIR = path.resolve(__dirname, "../../CRE/polymarket-info");
const CRE_BINARY = process.env.CRE_BINARY ?? "/usr/local/bin/cre";

// ABI — getMarket + updateMarketsDirect (admin bypass)
const ORACLE_ABI = [
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
] as const;

// ---------------------------------------------------------------------------

export interface VerifiedMarketData {
	conditionId: string;
	question: string;
	endDate: number;
	active: boolean;
	tokenId: string;
	negRisk: boolean;
	tickSize: string;
	source: "on-chain" | "gamma-fallback";
}

async function resolveGammaMarketId(conditionId: string): Promise<number | null> {
	const res = await fetch(`https://gamma-api.polymarket.com/markets?condition_ids=${conditionId}&limit=1`);
	if (!res.ok) return null;
	const markets = await res.json();
	const m = Array.isArray(markets) && markets.length > 0 ? markets[0] : null;
	if (!m?.id) return null;
	const id = Number(m.id);
	return Number.isFinite(id) ? id : null;
}

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
	console.log(`[CRE] Running simulation for markets: ${marketIds.join(", ")}`);
	// Turbo strips PATH — ensure /usr/local/bin is always present so `cre` is found
	const envPath = process.env.PATH ?? "";
	const enrichedPath = envPath.includes("/usr/local/bin")
		? envPath
		: `/usr/local/bin:/usr/bin:/bin:${envPath}`;

	// CRE reads .env from cwd — the .env lives one level up from the workflow dir
	const CRE_ROOT = path.resolve(CRE_WORKFLOW_DIR, "..");
	const { stdout, stderr } = await execFileAsync(CRE_BINARY, args, {
		cwd: CRE_ROOT,
		timeout: 60_000,
		env: { ...process.env, PATH: enrichedPath },
	});
	console.log(`[CRE] Simulation done: ${stdout.slice(0, 300)}`);
	if (stderr) console.debug(`[CRE] stderr: ${stderr.slice(0, 200)}`);
}

async function readOnChainMarket(conditionId: string): Promise<{
	conditionId: string;
	question: string;
	endDate: bigint;
	active: boolean;
	tokenId: string;
	negRisk: boolean;
	tickSize: string;
} | null> {
	const client = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });
	try {
		const data = encodeFunctionData({
			abi: ORACLE_ABI,
			functionName: "getMarket",
			args: [conditionId as `0x${string}`],
		});
		const raw = await client.call({ to: getOracleAddress(), data });
		// Empty or too-short response means market doesn't exist on-chain
		// The tuple has 8 fields including a dynamic string, so valid data is > 512 hex chars
		if (!raw.data || raw.data === "0x" || raw.data.length < 514) return null;

		const decoded = decodeFunctionResult({
			abi: ORACLE_ABI,
			functionName: "getMarket",
			data: raw.data,
		}) as any;

		const lastUpdate = BigInt(decoded.lastUpdate ?? decoded[7] ?? 0);
		if (lastUpdate === 0n) return null;

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
		};
	} catch (err) {
		console.warn(`[CRE] readOnChainMarket failed for ${conditionId}:`, err);
		return null;
	}
}

async function fetchGammaFallback(conditionId: string, outcome?: string): Promise<VerifiedMarketData> {
	console.log(`[CRE] ⚠️  FALLBACK → Gamma CLOB API | conditionId=${conditionId} outcome=${outcome ?? "Yes"}`);
	const url = `https://clob.polymarket.com/markets/${conditionId}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Cannot fetch market data for ${conditionId} (${res.status})`);
	const m = await res.json();

	const tokens: Array<{ token_id: string; outcome: string }> = m.tokens ?? [];
	const targetOutcome = outcome ?? "Yes";
	const token =
		tokens.find((t) => t.outcome.toLowerCase() === targetOutcome.toLowerCase()) ??
		tokens.find((t) => t.outcome === "Yes") ??
		tokens[0];

	console.log(`[CRE] ⚠️  FALLBACK result | question="${m.question}" tokenId=${token?.token_id} active=${m.active}`);

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

/**
 * Main entry: try CRE on-chain first, fallback to Gamma CLOB API.
 */
export async function fetchVerifiedMarketForSigning(
	conditionId: string,
	outcome?: string,
): Promise<VerifiedMarketData> {
	const isOracleDeployed =
		getOracleAddress() !== "0x0000000000000000000000000000000000000000";

	console.log(`[CRE] 🚀 fetchVerifiedMarketForSigning | conditionId=${conditionId} outcome=${outcome ?? "Yes"} oracleDeployed=${isOracleDeployed} oracleAddress=${getOracleAddress()}`);

	if (!isOracleDeployed) {
		console.warn(`[CRE] ⚠️  Oracle not deployed — skipping on-chain, using Gamma fallback`);
		return fetchGammaFallback(conditionId, outcome);
	}

	console.log(`[CRE] 🔍 Step 1 — Resolving Gamma marketId for conditionId=${conditionId}`);
	const marketId = await resolveGammaMarketId(conditionId);
	if (!marketId) {
		console.warn(`[CRE] ⚠️  Could not resolve Gamma marketId — using fallback`);
		return fetchGammaFallback(conditionId, outcome);
	}
	console.log(`[CRE] ✅ Step 1 — Gamma marketId=${marketId}`);

	console.log(`[CRE] 🔗 Step 2 — Running CRE simulation (broadcast on-chain) for marketId=${marketId}`);
	try {
		await runCRESimulation([marketId]);
		console.log(`[CRE] ✅ Step 2 — CRE simulation complete`);
	} catch (err) {
		console.warn(`[CRE] ⚠️  Step 2 — CRE simulation failed:`, err);
		console.warn(`[CRE] ⚠️  Falling back to Gamma`);
		return fetchGammaFallback(conditionId, outcome);
	}

	console.log(`[CRE] 📖 Step 3 — Reading on-chain market from oracle contract`);
	const onChain = await readOnChainMarket(conditionId);
	if (onChain) {
		console.log(`[CRE] ✅ Step 3 — ON-CHAIN data | question="${onChain.question}" active=${onChain.active} negRisk=${onChain.negRisk} tickSize=${onChain.tickSize}`);
		// On-chain stores only the Yes tokenId — if outcome is No, fetch No tokenId from Gamma
		if (outcome && outcome.toLowerCase() === "no") {
			console.log(`[CRE] ℹ️  Outcome is No — fetching No tokenId from Gamma (on-chain only stores Yes)`);
			const gamma = await fetchGammaFallback(conditionId, outcome);
			console.log(`[CRE] ✅ Final result | source=on-chain tokenId=${gamma.tokenId} (No)`);
			return {
				...gamma,
				question: onChain.question,
				active: onChain.active,
				negRisk: onChain.negRisk,
				tickSize: onChain.tickSize,
				source: "on-chain",
			};
		}
		console.log(`[CRE] ✅ Final result | source=on-chain tokenId=${onChain.tokenId}`);
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

	console.warn(`[CRE] ⚠️  Step 3 — Market not found on-chain after simulation — using fallback`);
	return fetchGammaFallback(conditionId, outcome);
}
