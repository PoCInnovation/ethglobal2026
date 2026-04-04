/**
 * Shared intent status update handler — used by both
 * POST /api/intents/status and PATCH /api/intents/:id/status.
 */
import type {
	IntentStatus,
	X402PaymentPayload,
	X402SettlementReceipt,
} from "@agent-intents/shared";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyAgentAuth } from "./agentAuth.js";
import { requireSession } from "./auth.js";
import { withDbRlsContext } from "./db.js";
import { authError, jsonError, jsonSuccess } from "./http.js";
import {
	IntentStatusConflictError,
	getIntentById,
	updateIntentStatus,
} from "./intentsRepo.js";
import { logger } from "./logger.js";

const AGENT_ALLOWED_STATUSES: IntentStatus[] = ["executing", "confirmed", "failed"];

const USER_ALLOWED_STATUSES: IntentStatus[] = [
	"approved",
	"rejected",
	"authorized",
	"broadcasting",
	"failed",
];

interface StatusUpdateFields {
	id: string;
	status: IntentStatus;
	txHash?: string;
	note?: string;
	paymentSignatureHeader?: string;
	paymentPayload?: unknown;
	settlementReceipt?: unknown;
	expiresAt?: string;
}

export async function handleStatusUpdate(
	req: VercelRequest,
	res: VercelResponse,
	fields: StatusUpdateFields,
) {
	const { id: intentId, status, ...rest } = fields;

	const authHeader = req.headers.authorization;
	if (authHeader?.startsWith("AgentAuth ")) {
		let member: { trustchainId: string };
		try {
			({ member } = await verifyAgentAuth(req));
		} catch (err) {
			const message = err instanceof Error ? err.message : "Authentication failed";
			authError(req, res, message, 401);
			return;
		}
		const existing = await withDbRlsContext(
			{ currentUser: member.trustchainId },
			async (client) => getIntentById(intentId, client.sql),
		);
		if (!existing) {
			jsonError(res, "Intent not found", 404);
			return;
		}
		if (!AGENT_ALLOWED_STATUSES.includes(status)) {
			authError(
				req,
				res,
				`Agents can only set status to: ${AGENT_ALLOWED_STATUSES.join(", ")}`,
				403,
				member.trustchainId,
			);
			return;
		}

		let intent: Awaited<ReturnType<typeof updateIntentStatus>>;
		try {
			intent = await withDbRlsContext({ currentUser: member.trustchainId }, async (client) =>
				updateIntentStatus(
					{
						id: intentId,
						status,
						txHash: rest.txHash,
						note: rest.note,
						paymentSignatureHeader: rest.paymentSignatureHeader,
						paymentPayload: rest.paymentPayload as X402PaymentPayload | undefined,
						settlementReceipt: rest.settlementReceipt as X402SettlementReceipt | undefined,
						expiresAt: rest.expiresAt,
					},
					client,
				),
			);
		} catch (err) {
			if (err instanceof IntentStatusConflictError) {
				jsonError(res, err.message, 409);
				return;
			}
			throw err;
		}

		if (!intent) {
			jsonError(res, "Intent not found", 404);
			return;
		}
		logger.info({ intentId: intent.id, status, txHash: rest.txHash }, `Intent ${status}`);
		jsonSuccess(res, { intent });
		return;
	}

	let session: { walletAddress: string };
	try {
		session = await requireSession(req);
	} catch {
		authError(req, res, "Authentication failed", 401);
		return;
	}

	const existing = await withDbRlsContext(
		{ currentUser: session.walletAddress },
		async (client) => getIntentById(intentId, client.sql),
	);
	if (!existing) {
		jsonError(res, "Intent not found", 404);
		return;
	}
	if (!USER_ALLOWED_STATUSES.includes(status)) {
		authError(
			req,
			res,
			`Users can only set status to: ${USER_ALLOWED_STATUSES.join(", ")}`,
			403,
			session.walletAddress,
		);
		return;
	}

	let intent: Awaited<ReturnType<typeof updateIntentStatus>>;
	try {
		intent = await withDbRlsContext({ currentUser: session.walletAddress }, async (client) =>
			updateIntentStatus(
				{
					id: intentId,
					status,
					txHash: rest.txHash,
					note: rest.note,
					paymentSignatureHeader: rest.paymentSignatureHeader,
					paymentPayload: rest.paymentPayload as X402PaymentPayload | undefined,
					settlementReceipt: rest.settlementReceipt as X402SettlementReceipt | undefined,
					expiresAt: rest.expiresAt,
				},
				client,
			),
		);
	} catch (err) {
		if (err instanceof IntentStatusConflictError) {
			jsonError(res, err.message, 409);
			return;
		}
		throw err;
	}

	if (!intent) {
		jsonError(res, "Intent not found", 404);
		return;
	}
	logger.info({ intentId: intent.id, status, txHash: rest.txHash }, `Intent ${status}`);
	jsonSuccess(res, { intent });
}
