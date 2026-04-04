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

	console.log(`\n╔══════════════════════════════════════════════════════════╗`);
	console.log(`║  🔍 POLYMARKET SCANNER — Scanning markets...             ║`);
	console.log(`║  Options: limit=${limit}, sortBy=${sortBy}, activeOnly=${activeOnly}`);
	console.log(`╚══════════════════════════════════════════════════════════╝`);

	// Fetch top markets from Gamma API sorted by volume
	const url = `${GAMMA_API}/markets?limit=${Math.min(limit * 2, 100)}&order=volume24hr&ascending=false&closed=false`;
	console.log(`[Scanner] 📡 Fetching from Gamma API...`);
	const res = await fetch(url);

	if (!res.ok) {
		console.error(`[Scanner] ❌ Gamma API error: ${res.status} ${res.statusText}`);
		throw new Error(`Gamma API error: ${res.status} ${res.statusText}`);
	}

	const rawMarkets: GammaMarket[] = await res.json();
	console.log(`[Scanner] 📦 Received ${rawMarkets.length} raw markets from Gamma API`);

	const opportunities: MarketOpportunity[] = [];

	for (const market of rawMarkets) {
		if (!market.conditionId) continue;
		if (activeOnly && (!market.active || market.closed)) continue;

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

		// Detailed log for each market found
		const pricesStr = outcomes.map(o => `${o.name}: ${(o.price * 100).toFixed(1)}%`).join(" | ");
		const signalEmoji = signal === "mispricing" ? "⚠️" : signal === "volume_spike" ? "📈" : signal === "momentum" ? "🚀" : "💡";
		console.log(`[Scanner] ──────────────────────────────────────────────`);
		console.log(`[Scanner] ${signalEmoji} Market: ${market.question}`);
		console.log(`[Scanner]   Condition ID: ${market.conditionId}`);
		console.log(`[Scanner]   Outcomes:     ${pricesStr}`);
		console.log(`[Scanner]   Volume 24h:   $${market.volume24hr?.toLocaleString() ?? "N/A"}`);
		console.log(`[Scanner]   Liquidity:    $${Number(market.liquidity).toLocaleString()}`);
		console.log(`[Scanner]   End Date:     ${market.endDate}`);
		console.log(`[Scanner]   Signal:       ${signal} (strength: ${signalStrength}/100)`);
		console.log(`[Scanner]   Memo:         ${memo}`);

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

	// Summary log
	const signalCounts = result.reduce((acc, o) => {
		acc[o.signal] = (acc[o.signal] || 0) + 1;
		return acc;
	}, {} as Record<string, number>);
	console.log(`[Scanner] ══════════════════════════════════════════════`);
	console.log(`[Scanner] ✅ Scan complete: ${result.length} opportunities found`);
	console.log(`[Scanner]   Signals: ${Object.entries(signalCounts).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
	console.log(`[Scanner]   Top market: "${result[0]?.question ?? "none"}"`);
	console.log(`\n`);

	return result;
}

/**
 * Fetch detailed info for a specific market by conditionId.
 */
export async function getMarketDetails(conditionId: string): Promise<MarketOpportunity | null> {
	console.log(`[Scanner] 🔎 Fetching details for conditionId: ${conditionId}`);
	// Gamma API supports querying by conditionId
	const url = `${GAMMA_API}/markets?condition_id=${conditionId}`;
	const res = await fetch(url);

	if (!res.ok) {
		console.error(`[Scanner] ❌ Gamma API error: ${res.status}`);
		return null;
	}

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
