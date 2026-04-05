/**
 * Polymarket Scanner — Detects trading opportunities from Polymarket markets.
 *
 * Fetches active markets from Gamma API, enriches with CLOB price data,
 * and identifies signals (mispricing, momentum, volume spikes).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketOutcome {
	name: string;
	price: number;
	tokenId: string;
}

export interface MarketOpportunity {
	conditionId: string;
	question: string;
	outcomes: MarketOutcome[];
	volume24h: number;
	liquidity: number;
	endDate: string;
	active: boolean;
	signal: "mispricing" | "momentum" | "volume_spike" | "interesting";
	signalStrength: number; // 0–100
	memo: string;
}

export interface ScanOptions {
	limit?: number;
	sortBy?: "volume" | "liquidity" | "signal" | "endDate";
	activeOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";

/** Same idea as apps/web/api/polymarket/markets.ts — Gamma endDate is often stale for sports. */
const MIN_RESOLUTION_LEAD_MS = 6 * 60 * 60 * 1000;

/**
 * True if the market is still tradeable at `nowMs`: end is in the future with a buffer.
 * Uses getTime() so comparisons are unambiguous vs server clock.
 */
export function isMarketEndDateStillValid(endDate: string, nowMs: number = Date.now()): boolean {
	const endMs = new Date(endDate).getTime();
	if (!Number.isFinite(endMs)) return false;
	const cutoff = nowMs + MIN_RESOLUTION_LEAD_MS;
	return endMs > cutoff;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface GammaMarket {
	id: number;
	conditionId: string;
	question: string;
	outcomes: string; // JSON stringified ["Yes","No"]
	outcomePrices: string; // JSON stringified ["0.65","0.35"]
	clobTokenIds: string; // JSON stringified
	volume24hr: number;
	liquidity: string;
	endDate: string;
	active: boolean;
	closed: boolean;
	spread?: number;
}

function parseJsonField<T>(raw: string | T): T {
	if (typeof raw === "string") return JSON.parse(raw) as T;
	return raw;
}

function detectSignal(market: GammaMarket, prices: number[]): {
	signal: MarketOpportunity["signal"];
	signalStrength: number;
	memo: string;
} {
	// 1. Mispricing: prices should roughly sum to 1.0 for a binary market
	const priceSum = prices.reduce((s, p) => s + p, 0);
	if (Math.abs(priceSum - 1.0) > 0.05) {
		const deviation = Math.abs(priceSum - 1.0);
		return {
			signal: "mispricing",
			signalStrength: Math.min(100, Math.round(deviation * 500)),
			memo: `Price sum ${priceSum.toFixed(3)} deviates from 1.0 — possible mispricing (spread: ${(deviation * 100).toFixed(1)}%)`,
		};
	}

	// 2. Volume spike: high 24h volume relative to liquidity
	const liq = Number(market.liquidity) || 1;
	const volRatio = market.volume24hr / liq;
	if (volRatio > 0.5) {
		return {
			signal: "volume_spike",
			signalStrength: Math.min(100, Math.round(volRatio * 80)),
			memo: `Volume/liquidity ratio ${volRatio.toFixed(2)} — unusual activity (24h vol: $${market.volume24hr.toLocaleString()})`,
		};
	}

	// 3. Momentum: extreme price (near 0 or 1) might signal strong conviction
	const extremePrice = prices.find((p) => p > 0.85 || p < 0.15);
	if (extremePrice !== undefined) {
		const distance = Math.min(extremePrice, 1 - extremePrice);
		return {
			signal: "momentum",
			signalStrength: Math.min(100, Math.round((1 - distance * 10) * 60)),
			memo: `Strong directional conviction — one outcome at ${(extremePrice * 100).toFixed(0)}%`,
		};
	}

	// 4. Default: interesting if it has decent volume
	return {
		signal: "interesting",
		signalStrength: Math.min(50, Math.round(market.volume24hr / 1000)),
		memo: `Active market with $${market.volume24hr.toLocaleString()} 24h volume`,
	};
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/**
 * Fetch active Polymarket markets and identify trading opportunities.
 */
export async function scanMarkets(options: ScanOptions = {}): Promise<MarketOpportunity[]> {
	const { limit = 20, sortBy = "volume", activeOnly = true } = options;
	const nowMs = Date.now();

	console.log(`\n╔══════════════════════════════════════════════════════════╗`);
	console.log(`║  🔍 POLYMARKET SCANNER — Scanning markets...             ║`);
	console.log(`║  Options: limit=${limit}, sortBy=${sortBy}, activeOnly=${activeOnly}`);
	console.log(`╚══════════════════════════════════════════════════════════╝`);
	console.log(`[Scanner] Clock (UTC): ${new Date(nowMs).toISOString()} — endDate must be > now + 6h`);

	// Over-fetch: many rows are dropped (invalid endDate vs now, or resolve too soon)
	const fetchCap = Math.min(Math.max(limit * 4, 40), 100);
	const url = `${GAMMA_API}/markets?limit=${Math.min(limit * 2, 100)}&order=volume24hr&ascending=false&closed=false`;
	console.log(`[Scanner] 📡 Fetching from Gamma API...`);
	const res = await fetch(url);

	if (!res.ok) {
		throw new Error(`Gamma API error: ${res.status} ${res.statusText}`);
	}

	const rawMarkets: GammaMarket[] = await res.json();

	const opportunities: MarketOpportunity[] = [];

	for (const market of rawMarkets) {
		if (!market.conditionId) continue;
		if (activeOnly && (!market.active || market.closed)) continue;

		if (!isMarketEndDateStillValid(market.endDate, nowMs)) {
			const endMs = new Date(market.endDate).getTime();
			console.log(
				`[Scanner] ⏭️ Skipped (outdated / resolves too soon): "${market.question.slice(0, 60)}..." endDate=${market.endDate} endMs=${endMs} nowMs=${nowMs}`,
			);
			continue;
		}

		const outcomeNames = parseJsonField<string[]>(market.outcomes);
		const outcomePrices = parseJsonField<string[]>(market.outcomePrices);
		const clobTokenIds = parseJsonField<string[]>(market.clobTokenIds);

		const prices = outcomePrices.map((p) => Number.parseFloat(p));
		const { signal, signalStrength, memo } = detectSignal(market, prices);

		const outcomes: MarketOutcome[] = outcomeNames.map((name, i) => ({
			name,
			price: prices[i] ?? 0,
			tokenId: clobTokenIds[i] ?? "",
		}));


		opportunities.push({
			conditionId: market.conditionId,
			question: market.question,
			outcomes,
			volume24h: market.volume24hr ?? 0,
			liquidity: Number(market.liquidity) || 0,
			endDate: market.endDate,
			active: market.active,
			signal,
			signalStrength,
			memo,
		});
	}

	// Sort by chosen criteria
	opportunities.sort((a, b) => {
		switch (sortBy) {
			case "signal":
				return b.signalStrength - a.signalStrength;
			case "liquidity":
				return b.liquidity - a.liquidity;
			case "endDate":
				return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
			case "volume":
			default:
				return b.volume24h - a.volume24h;
		}
	});

	const result = opportunities.slice(0, limit);

	return result;
}

/**
 * Fetch detailed info for a specific market by conditionId.
 */
export async function getMarketDetails(conditionId: string): Promise<MarketOpportunity | null> {
	// Gamma API supports querying by conditionId
	const url = `${GAMMA_API}/markets?condition_id=${conditionId}`;
	const res = await fetch(url);

	if (!res.ok) return null;

	const markets: GammaMarket[] = await res.json();
	if (!markets.length || !markets[0]) return null;

	const market = markets[0];
	const outcomeNames = parseJsonField<string[]>(market.outcomes);
	const outcomePrices = parseJsonField<string[]>(market.outcomePrices);
	const clobTokenIds = parseJsonField<string[]>(market.clobTokenIds);
	const prices = outcomePrices.map((p) => Number.parseFloat(p));

	const { signal, signalStrength, memo } = detectSignal(market, prices);

	const outcomes: MarketOutcome[] = outcomeNames.map((name, i) => ({
		name,
		price: prices[i] ?? 0,
		tokenId: clobTokenIds[i] ?? "",
	}));

	return {
		conditionId: market.conditionId,
		question: market.question,
		outcomes,
		volume24h: market.volume24hr ?? 0,
		liquidity: Number(market.liquidity) || 0,
		endDate: market.endDate,
		active: market.active,
		signal,
		signalStrength,
		memo,
	};
}
