/**
 * POST /api/polymarket/verify
 *
 * Triggered by the frontend right before signing a Polymarket trade.
 * Runs the CRE workflow to write market data on-chain (Sepolia), then
 * reads it back from the PolymarketOracle contract.
 *
 * Returns verified market data: { question, endDate, active, source }
 *
 * Auth: session cookie (same as /api/me)
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { jsonError, jsonSuccess, methodRouter } from "../_lib/http.js";
import { logger } from "../_lib/logger.js";
import { fetchVerifiedMarketForSigning } from "../_lib/oracleCre.js";
import { requireSession } from "../_lib/auth.js";

export default methodRouter({
	POST: async (req: VercelRequest, res: VercelResponse) => {
		// Auth check
		try {
			await requireSession(req);
		} catch {
			jsonError(res, "Not authenticated", 401);
			return;
		}

		const { conditionId, outcome } = req.body ?? {};
		if (!conditionId || typeof conditionId !== "string") {
			jsonError(res, "conditionId is required", 400);
			return;
		}

		logger.info({ conditionId, outcome }, "Fetching verified market data for signing");

		try {
			const market = await fetchVerifiedMarketForSigning(conditionId, outcome);
			logger.info({ conditionId, source: market.source, question: market.question }, "Verified market data ready");
			jsonSuccess(res, market);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Failed to verify market";
			logger.error({ err, conditionId }, "Market verification failed");
			jsonError(res, msg, 502);
		}
	},
});
