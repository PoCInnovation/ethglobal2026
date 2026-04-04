/**
 * SSE endpoint for council deliberation.
 *
 * GET /api/council/deliberate?intentId=...
 *
 * Streams CouncilEvents as server-sent events while the AI council
 * deliberates on a Polymarket trade intent.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireSession } from "../_lib/auth.js";
import { runCouncilDeliberation } from "../_lib/councilOrchestrator.js";
import type { CouncilEvent, CouncilResult } from "../_lib/councilTypes.js";
import { sql } from "../_lib/db.js";
import { setCorsHeaders } from "../_lib/http.js";
import { getIntentById } from "../_lib/intentsRepo.js";

// ---------- Helpers ----------

function sseEvent(type: string, data: unknown): string {
	return `data: ${JSON.stringify({ type, payload: data })}\n\n`;
}

async function saveCouncilResult(intentId: string, result: CouncilResult): Promise<void> {
	await sql`
		UPDATE intents
		SET details = jsonb_set(details, '{councilResult}', ${JSON.stringify(result)}::jsonb)
		WHERE id = ${intentId}
	`;
}

// ---------- Handler ----------

export default async function handler(req: VercelRequest, res: VercelResponse) {
	// 1. GET only (+ OPTIONS for CORS)
	if (req.method === "OPTIONS") {
		setCorsHeaders(res, req);
		res.status(200).end();
		return;
	}
	if (req.method !== "GET") {
		res.status(405).end();
		return;
	}

	// 2. CORS headers
	setCorsHeaders(res, req);

	// 3. Auth via cookie session
	let session: { sessionId: string; walletAddress: string };
	try {
		session = await requireSession(req);
	} catch {
		console.warn("[council/deliberate] 401 — no valid session cookie. cookies:", req.headers.cookie ? "present" : "absent");
		res.status(401).json({ error: "Unauthorized" });
		return;
	}

	// 4. Read intentId from query params
	const intentId = req.query.intentId as string | undefined;
	if (!intentId) {
		res.status(400).json({ error: "Missing intentId" });
		return;
	}

	// 5. Read intent from DB, verify ownership
	const intent = await getIntentById(intentId);
	if (!intent) {
		console.warn("[council/deliberate] 404 — intent not found:", intentId);
		res.status(404).json({ error: "Intent not found" });
		return;
	}
	if (intent.userId !== session.walletAddress) {
		console.warn("[council/deliberate] 403 — ownership mismatch. intent.userId:", intent.userId, "session:", session.walletAddress);
		res.status(404).json({ error: "Intent not found" });
		return;
	}
	if (intent.details.type !== "polymarket_trade") {
		console.warn("[council/deliberate] 400 — wrong type:", intent.details.type);
		res.status(400).json({ error: "Not a Polymarket trade" });
		return;
	}

	console.log("[council/deliberate] Starting deliberation for intent:", intentId, "wallet:", session.walletAddress);

	// 6. Check cache: if council_result already exists in intent details
	const cachedResult = (intent.details as Record<string, unknown>).councilResult;
	if (cachedResult) {
		console.log("[council/deliberate] Returning cached result for:", intentId);
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
			"X-Accel-Buffering": "no",
		});
		res.write(sseEvent("council_cached", cachedResult));
		res.end();
		return;
	}

	// 7. Rate limit (TODO: add rate limiting per user for deliberation requests)

	// 8. Setup SSE
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		"Connection": "keep-alive",
		"X-Accel-Buffering": "no",
	});

	// 9. AbortController for cleanup
	const abort = new AbortController();
	res.on("close", () => abort.abort());

	// 10. Run deliberation
	const emit = (event: CouncilEvent) => {
		if (!res.closed) {
			res.write(`data: ${JSON.stringify(event)}\n\n`);
		}
	};

	try {
		const result = await runCouncilDeliberation(
			{
				marketTitle: intent.details.marketTitle,
				conditionId: intent.details.conditionId,
				outcome: intent.details.outcome,
				amount: intent.details.amount,
				outcomePrice: intent.details.outcomePrice,
			},
			emit,
			abort.signal,
		);

		// 11. Save council result to intent
		console.log("[council/deliberate] Deliberation complete, saving result for:", intentId, "approved:", result.approved);
		await saveCouncilResult(intentId, result);
	} catch (err) {
		console.error("[council/deliberate] Deliberation error for:", intentId, err);
		if (!abort.signal.aborted) {
			emit({ type: "error", payload: { fatal: true, message: String(err) } });
		}
	}

	// 12. Close SSE
	res.end();
}
