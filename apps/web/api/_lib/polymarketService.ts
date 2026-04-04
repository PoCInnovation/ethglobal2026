/**
 * Polymarket enrichment service — fetches market data from the Gamma API
 * and enriches polymarket_trade intents with verified titles and prices.
 */

import type { PolymarketTradeDetails } from "@agent-intents/shared";
import { POLYMARKET_CONFIG } from "@agent-intents/shared";
import { logger } from "./logger.js";

interface GammaMarketToken {
	token_id: string;
	outcome: string;
	price: number;
}

interface GammaMarket {
	condition_id: string;
	question: string;
	outcomes: string;
	active: boolean;
	closed: boolean;
	end_date_iso: string;
	tokens: GammaMarketToken[];
}

export async function fetchMarketByConditionId(conditionId: string): Promise<GammaMarket | null> {
	const url = `${POLYMARKET_CONFIG.GAMMA_API_BASE}/markets?condition_id=${conditionId}`;
	try {
		const res = await fetch(url);
		if (!res.ok) {
			logger.warn({ status: res.status, conditionId }, "Gamma API returned non-OK status");
			return null;
		}
		const markets: GammaMarket[] = await res.json();
		return markets.length > 0 ? markets[0] : null;
	} catch (err) {
		logger.error({ err, conditionId }, "Failed to fetch market from Gamma API");
		return null;
	}
}

export function validateMarketActive(market: GammaMarket): string | null {
	if (!market.active || market.closed) {
		return "Market is no longer active";
	}
	if (market.end_date_iso) {
		const endDate = new Date(market.end_date_iso);
		if (endDate.getTime() < Date.now()) {
			return "Market has expired";
		}
	}
	return null;
}

/**
 * Enrich a polymarket_trade intent with verified market title and current
 * outcome price from the Gamma API.
 *
 * Throws on validation failures (market not found, inactive, etc.).
 */
export async function enrichPolymarketIntent(
	details: PolymarketTradeDetails,
): Promise<PolymarketTradeDetails> {
	const market = await fetchMarketByConditionId(details.conditionId);

	if (!market) {
		throw new Error(`Market not found for conditionId: ${details.conditionId}`);
	}

	const validationError = validateMarketActive(market);
	if (validationError) {
		throw new Error(validationError);
	}

	const outcomeIndex = details.outcome === "Yes" ? 0 : 1;
	const outcomePrice = market.tokens?.[outcomeIndex]?.price ?? undefined;

	// Resolve token IDs for both outcomes
	const yesToken = market.tokens?.find((t) => t.outcome === "Yes");
	const noToken = market.tokens?.find((t) => t.outcome === "No");
	const outcomeTokenIds =
		yesToken && noToken ? { yes: yesToken.token_id, no: noToken.token_id } : undefined;
	const tokenId = details.outcome === "Yes" ? yesToken?.token_id : noToken?.token_id;

	return {
		...details,
		marketTitle: market.question,
		outcomePrice,
		tokenId,
		outcomeTokenIds,
	};
}
