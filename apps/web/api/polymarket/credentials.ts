/**
 * GET /api/polymarket/credentials
 *
 * Returns whether Polymarket CLOB credentials are configured server-side.
 * Does not return secrets — just a boolean `connected` flag.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { jsonSuccess, methodRouter } from "../_lib/http.js";

export default methodRouter({
	GET: async (_req: VercelRequest, res: VercelResponse) => {
		const connected = !!(
			process.env.POLYMARKET_API_KEY &&
			process.env.POLYMARKET_API_SECRET &&
			process.env.POLYMARKET_PASSPHRASE
		);
		jsonSuccess(res, { connected });
	},
});
