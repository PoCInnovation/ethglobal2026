/**
 * Update intent status endpoint (static path)
 *
 * POST /api/intents/status  { id, status, txHash?, note?, ... }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { methodRouter, parseBodyWithSchema } from "../_lib/http.js";
import { handleStatusUpdate } from "../_lib/statusHandler.js";
import { updateStatusBodySchema } from "../_lib/validation.js";

export default methodRouter({
	POST: async (req: VercelRequest, res: VercelResponse) => {
		const body = parseBodyWithSchema(req, res, updateStatusBodySchema);
		if (body === null) return;
		await handleStatusUpdate(req, res, body);
	},
});
