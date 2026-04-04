/**
 * Update intent status endpoint (legacy dynamic route)
 * PATCH /api/intents/:id/status
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { jsonError, methodRouter, parseBodyWithSchema } from "../../_lib/http.js";
import { handleStatusUpdate } from "../../_lib/statusHandler.js";
import { updateStatusBodyLegacySchema } from "../../_lib/validation.js";

export default methodRouter({
	PATCH: async (req: VercelRequest, res: VercelResponse) => {
		const { id } = req.query;
		const intentId = Array.isArray(id) ? id[0] : id;

		if (!intentId) {
			jsonError(res, "Intent ID required", 400);
			return;
		}

		const body = parseBodyWithSchema(req, res, updateStatusBodyLegacySchema);
		if (body === null) return;
		await handleStatusUpdate(req, res, { id: intentId, ...body });
	},
});
