/**
 * GET /api/polymarket/markets?q=<search>&limit=<n>
 *
 * Public endpoint (no auth required) that proxies the Polymarket Gamma API
 * and returns a simplified list of active markets. Agents use this to
 * discover conditionIds before creating polymarket_trade intents.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { POLYMARKET_CONFIG } from "@agent-intents/shared";
import { getQueryParam, getQueryNumber, jsonError, jsonSuccess, methodRouter } from "../_lib/http.js";
import { logger } from "../_lib/logger.js";

interface GammaMarketToken {
	token_id: string;
	outcome: string;
	price: number;
}

interface GammaMarket {
	conditionId: string;
	question: string;
	outcomes: string;
	outcomePrices: string;
	active: boolean;
	closed: boolean;
	endDate: string;
	volume: string;
	tokens: GammaMarketToken[];
}

interface MarketResult {
	conditionId: string;
	question: string;
	yesPrice: number;
	noPrice: number;
	volume: number;
	endDate: string;
	active: boolean;
}

export default methodRouter({
	GET: async (req: VercelRequest, res: VercelResponse) => {
		const q = getQueryParam(req, "q") ?? "";
		const limit = getQueryNumber(req, "limit", 10, 1, 50);

		const fetchLimit = q ? 200 : limit;

		const params = new URLSearchParams({
			active: "true",
			closed: "false",
			limit: String(fetchLimit),
			order: "volume",
			ascending: "false",
		});

		const url = `${POLYMARKET_CONFIG.GAMMA_API_BASE}/markets?${params}`;

		try {
			const response = await fetch(url);
			if (!response.ok) {
				logger.warn({ status: response.status }, "Gamma API error");
				jsonError(res, "Failed to fetch markets from Polymarket", 502);
				return;
			}

			const raw: GammaMarket[] = await response.json();

			// Filter out markets ending within 6h — sports markets often have
			// stale Gamma endDate but CLOB already marks them as expired.
			const sixHoursFromNow = new Date(Date.now() + 6 * 60 * 60 * 1000);
			let markets: MarketResult[] = raw
				.filter((m) => {
					if (!m.active || m.closed || !m.conditionId) return false;
					const end = new Date(m.endDate);
					const passes = end > sixHoursFromNow;
					if (!passes) {
						logger.info({ conditionId: m.conditionId, question: m.question, endDate: m.endDate }, "Market filtered out (ends within 6h)");
					}
					return passes;
				})
				.map((m) => {
					const prices: string[] = JSON.parse(m.outcomePrices || "[]");
					return {
						conditionId: m.conditionId,
						question: m.question,
						yesPrice: Number(prices[0] ?? m.tokens?.[0]?.price ?? 0),
						noPrice: Number(prices[1] ?? m.tokens?.[1]?.price ?? 0),
						volume: Number(m.volume || 0),
						endDate: m.endDate,
						active: true,
					};
				});

			if (q) {
				const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
				markets = markets.filter((m) => {
					const text = m.question.toLowerCase();
					return terms.every((t) => text.includes(t));
				});
			}

			jsonSuccess(res, { markets: markets.slice(0, limit) });
		} catch (err) {
			logger.error({ err }, "Failed to proxy Gamma API");
			jsonError(res, "Service temporarily unavailable", 503);
		}
	},
});
