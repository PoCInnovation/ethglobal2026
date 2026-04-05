/**
 * GET /api/polymarket/simulate?tokenId=<tokenId>
 *
 * Fetches live price, negRisk flag and tick size for a Polymarket outcome token.
 * Used by the frontend right before signing to build the EIP-712 order.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getQueryParam, jsonError, jsonSuccess, methodRouter } from "../_lib/http.js";
import { logger } from "../_lib/logger.js";

const CLOB_API_BASE = "https://clob.polymarket.com";

export default methodRouter({
	GET: async (req: VercelRequest, res: VercelResponse) => {
		const tokenId = getQueryParam(req, "tokenId");
		if (!tokenId) {
			jsonError(res, "tokenId is required", 400);
			return;
		}

		try {
			// Fetch price from CLOB
			const priceRes = await fetch(`${CLOB_API_BASE}/price?token_id=${tokenId}&side=BUY`);
			if (!priceRes.ok) {
				jsonError(res, `CLOB price fetch failed: ${priceRes.status}`, 502);
				return;
			}
			const priceData = await priceRes.json();
			const price = Number(priceData.price);
			if (!price || price <= 0 || price >= 1) {
				jsonError(res, `Invalid price from CLOB: ${priceData.price}`, 502);
				return;
			}

			// Fetch market info for negRisk + tickSize
			const marketRes = await fetch(`${CLOB_API_BASE}/markets/${tokenId}`);
			let negRisk = false;
			let tickSize = "0.01";
			let question = "";
			let outcome = "";

			if (marketRes.ok) {
				const market = await marketRes.json();
				negRisk = market.neg_risk ?? false;
				tickSize = market.minimum_tick_size ?? "0.01";
				question = market.question ?? "";
				const token = market.tokens?.find((t: { token_id: string }) => t.token_id === tokenId);
				outcome = token?.outcome ?? "";
			} else {
				// Fallback: fetch by token_id directly
				const tokenRes = await fetch(`${CLOB_API_BASE}/markets?token_id=${tokenId}`);
				if (tokenRes.ok) {
					const data = await tokenRes.json();
					const market = Array.isArray(data) ? data[0] : data;
					negRisk = market?.neg_risk ?? false;
					tickSize = market?.minimum_tick_size ?? "0.01";
					question = market?.question ?? "";
					const token = market?.tokens?.find((t: { token_id: string }) => t.token_id === tokenId);
					outcome = token?.outcome ?? "";
				}
			}

			logger.info({ tokenId, price, negRisk, tickSize }, "Simulation result");

			jsonSuccess(res, { tokenId, price, negRisk, tickSize, question, outcome });
		} catch (err) {
			logger.error({ err, tokenId }, "Simulate endpoint failed");
			jsonError(res, "Failed to fetch market simulation data", 502);
		}
	},
});
