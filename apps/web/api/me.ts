/**
 * Return authenticated wallet from session cookie.
 * GET /api/me
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireSession } from "./_lib/auth.js";
import { jsonSuccess, methodRouter } from "./_lib/http.js";

export default methodRouter({
	GET: async (req: VercelRequest, res: VercelResponse) => {
		try {
			const session = await requireSession(req);
			jsonSuccess(res, { walletAddress: session.walletAddress });
		} catch {
			// 200 + success:false avoids browser console noise on optional session probe (same as Express dev).
			res.status(200).json({ success: false, error: "Authentication required" });
		}
	},
});
