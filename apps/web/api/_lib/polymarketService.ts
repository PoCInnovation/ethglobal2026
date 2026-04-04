/**
 * Polymarket enrichment service — fetches market data from the CLOB API
 * (primary) or Gamma API (fallback) and enriches polymarket_trade intents
 * with verified titles and prices.
 */

import type { PolymarketTradeDetails } from "@agent-intents/shared";
import { POLYMARKET_CONFIG } from "@agent-intents/shared";
import { logger } from "./logger.js";

interface MarketToken {
	token_id: string;
	outcome: string;
	price: number;
}

interface NormalizedMarket {
	condition_id: string;
	question: string;
	active: boolean;
	closed: boolean;
	end_date_iso: string | null;
	tokens: MarketToken[];
	source: "clob" | "gamma";
}

/**
 * CLOB API returns a single market object (not an array).
 * Endpoint: GET /markets/{conditionId}
 */
async function fetchFromClob(conditionId: string): Promise<NormalizedMarket | null> {
	const url = `${POLYMARKET_CONFIG.CLOB_API_BASE}/markets/${conditionId}`;
	try {
		logger.info({ url, conditionId }, "Fetching market from CLOB API");
		const res = await fetch(url);
		if (!res.ok) {
			logger.warn({ status: res.status, conditionId }, "CLOB API returned non-OK status");
			return null;
		}
		const m = await res.json();
		if (!m || !m.question) return null;
		return {
			condition_id: m.condition_id ?? conditionId,
			question: m.question,
			active: m.active ?? false,
			closed: m.closed ?? true,
			end_date_iso: m.end_date_iso ?? null,
			tokens: Array.isArray(m.tokens) ? m.tokens : [],
			source: "clob",
		};
	} catch (err) {
		logger.error({ err, conditionId }, "Failed to fetch market from CLOB API");
		return null;
	}
}

/**
 * Gamma API fallback — filters by condition_id query param.
 * May return wrong results for newer markets where condition_id is null.
 */
async function fetchFromGamma(conditionId: string): Promise<NormalizedMarket | null> {
	const url = `${POLYMARKET_CONFIG.GAMMA_API_BASE}/markets?condition_id=${conditionId}`;
	try {
		logger.info({ url, conditionId }, "Fetching market from Gamma API (fallback)");
		const res = await fetch(url);
		if (!res.ok) {
			logger.warn({ status: res.status, conditionId }, "Gamma API returned non-OK status");
			return null;
		}
		const markets = await res.json();
		const m = Array.isArray(markets) && markets.length > 0 ? markets[0] : null;
		if (!m) return null;
		return {
			condition_id: m.condition_id ?? conditionId,
			question: m.question,
			active: m.active ?? false,
			closed: m.closed ?? true,
			end_date_iso: m.end_date_iso ?? null,
			tokens: Array.isArray(m.tokens) ? m.tokens : [],
			source: "gamma",
		};
	} catch (err) {
		logger.error({ err, conditionId }, "Failed to fetch market from Gamma API");
		return null;
	}
}

export async function fetchMarketByConditionId(conditionId: string): Promise<NormalizedMarket | null> {
	const market = await fetchFromClob(conditionId);
	if (market) {
		logger.info(
			{ conditionId, question: market.question, active: market.active, closed: market.closed, source: market.source },
			"Market fetched successfully",
		);
		return market;
	}

	logger.warn({ conditionId }, "CLOB lookup failed, falling back to Gamma");
	const gammaMarket = await fetchFromGamma(conditionId);
	if (gammaMarket) {
		logger.info(
			{ conditionId, question: gammaMarket.question, active: gammaMarket.active, closed: gammaMarket.closed, source: gammaMarket.source },
			"Market fetched from Gamma fallback",
		);
	}
	return gammaMarket;
}

export function validateMarketActive(market: NormalizedMarket): string | null {
	if (!market.active || market.closed) {
		logger.warn(
			{ conditionId: market.condition_id, active: market.active, closed: market.closed, source: market.source },
			"Market validation failed: not active or closed",
		);
		return "Market is no longer active";
	}
	if (market.end_date_iso) {
		const endDate = new Date(market.end_date_iso);
		const now = Date.now();
		logger.info(
			{ conditionId: market.condition_id, end_date_iso: market.end_date_iso, endDateMs: endDate.getTime(), nowMs: now, diffMinutes: Math.round((endDate.getTime() - now) / 60000) },
			"Checking market expiry",
		);
		if (endDate.getTime() < now) {
			logger.warn(
				{ conditionId: market.condition_id, end_date_iso: market.end_date_iso, expiredSinceMinutes: Math.round((now - endDate.getTime()) / 60000) },
				"Market validation failed: expired",
			);
			return "Market has expired";
		}
	}
	return null;
}

/**
 * Enrich a polymarket_trade intent with verified market title and current
 * outcome price.
 *
 * Throws on validation failures (market not found, inactive, etc.).
 */
export async function enrichPolymarketIntent(
	details: PolymarketTradeDetails,
): Promise<PolymarketTradeDetails> {
	logger.info({ conditionId: details.conditionId, outcome: details.outcome, amount: details.amount }, "Enriching polymarket intent");

	const market = await fetchMarketByConditionId(details.conditionId);

	if (!market) {
		logger.error({ conditionId: details.conditionId }, "Market not found on CLOB or Gamma");
		throw new Error(`Market not found for conditionId: ${details.conditionId}`);
	}

	const validationError = validateMarketActive(market);
	if (validationError) {
		throw new Error(validationError);
	}

	const outcomeIndex = details.outcome === "Yes" ? 0 : 1;
	const outcomeToken = market.tokens?.[outcomeIndex];
	const outcomePrice = outcomeToken?.price ?? undefined;
	const tokenId = outcomeToken?.token_id ?? undefined;

	logger.info(
		{ conditionId: details.conditionId, marketTitle: market.question, outcomePrice, tokenId, source: market.source },
		"Polymarket intent enriched successfully",
	);

	return {
		...details,
		marketTitle: market.question,
		outcomePrice,
		tokenId,
	};
}
