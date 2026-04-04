/**
 * Agent Payments with Ledger Backend Service
 *
 * REST API for:
 * - Agents to submit transaction intents
 * - Live App to fetch pending intents
 * - Status updates when intents are signed/rejected
 */

import {
	type CreateIntentRequest,
	type Intent,
	type IntentStatus,
	type X402PaymentPayload,
	getExplorerTxUrl,
} from "@agent-intents/shared";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import cors from "cors";
import express from "express";
import { v4 as uuidv4 } from "uuid";

const app = express();
const PORT = process.env.PORT || 3005;

// Middleware - CORS with explicit configuration for development
app.use(
	cors({
		origin: true, // Reflect the request origin (allows any origin in development)
		credentials: true,
		methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization"],
	}),
);
app.use(express.json());

// Cookie parser (lightweight, no dependency)
function parseCookies(header: string | undefined): Record<string, string> {
	if (!header) return {};
	const out: Record<string, string> = {};
	for (const pair of header.split(";")) {
		const [k, ...v] = pair.split("=");
		if (k) out[k.trim()] = decodeURIComponent(v.join("=").trim());
	}
	return out;
}

// In-memory stores (replace with DB for production)
const intents = new Map<string, Intent>();

// ============ Auth In-Memory Store ============
interface AuthChallenge {
	id: string;
	walletAddress: string;
	nonce: string;
	message: string;
	expiresAt: number; // epoch ms
	usedAt: number | null;
}
interface AuthSession {
	id: string;
	walletAddress: string;
	expiresAt: number; // epoch ms
}
const authChallenges = new Map<string, AuthChallenge>();
const authSessions = new Map<string, AuthSession>();

const SESSION_COOKIE_NAME = "ai_session";
const CHALLENGE_VALIDITY_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function buildWelcomeMessage(nonce: string): string {
	return `Welcome to agentintents.io\n\nNonce: ${nonce}`;
}

// ============ Agent / Trustchain In-Memory Store ============
interface TrustchainMember {
	id: string;
	trustchainId: string;
	memberPubkey: string;
	role: string;
	label: string | null;
	createdAt: string;
	revokedAt: string | null;
}
const agents = new Map<string, TrustchainMember>();

// Helper: create intent from request
function createIntent(req: CreateIntentRequest, userId: string): Intent {
	const now = new Date().toISOString();
	const id = `int_${Date.now()}_${uuidv4().slice(0, 8)}`;

	const expiresAt = req.expiresInMinutes
		? new Date(Date.now() + req.expiresInMinutes * 60 * 1000).toISOString()
		: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // Default 24h

	return {
		id,
		userId,
		agentId: req.agentId,
		agentName: req.agentName,
		details: req.details,
		urgency: req.urgency || "normal",
		status: "pending",
		createdAt: now,
		expiresAt,
		statusHistory: [{ status: "pending", timestamp: now }],
	};
}

// Health check
app.get("/health", (_req, res) => {
	res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============ Auth API ============

// POST /api/auth/challenge – issue a personal_sign challenge
app.post("/api/auth/challenge", (req, res) => {
	const { walletAddress } = req.body as { walletAddress?: string };
	if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
		res.status(400).json({ success: false, error: "Invalid wallet address" });
		return;
	}
	const wallet = walletAddress.toLowerCase();
	const nonce = uuidv4();
	const message = buildWelcomeMessage(nonce);
	const challenge: AuthChallenge = {
		id: uuidv4(),
		walletAddress: wallet,
		nonce,
		message,
		expiresAt: Date.now() + CHALLENGE_VALIDITY_MS,
		usedAt: null,
	};
	authChallenges.set(challenge.id, challenge);
	console.log(`[Auth Challenge] ${wallet} nonce=${nonce}`);
	res.json({ success: true, nonce, message });
});

// POST /api/auth/verify – verify signature and create session
app.post("/api/auth/verify", async (req, res) => {
	const { walletAddress, nonce, signature } = req.body as {
		walletAddress?: string;
		nonce?: string;
		signature?: string;
	};
	if (!walletAddress || !nonce || !signature) {
		res.status(400).json({ success: false, error: "Missing required fields" });
		return;
	}
	const wallet = walletAddress.toLowerCase();

	// Find matching challenge
	const challenge = Array.from(authChallenges.values()).find(
		(c) => c.walletAddress === wallet && c.nonce === nonce && !c.usedAt && c.expiresAt > Date.now(),
	);
	if (!challenge) {
		res.status(401).json({ success: false, error: "Invalid or expired challenge" });
		return;
	}

	// Verify signature
	try {
		const { recoverMessageAddress } = await import("viem");
		const recovered = await recoverMessageAddress({
			message: challenge.message,
			signature: signature as `0x${string}`,
		});
		if (recovered.toLowerCase() !== wallet) {
			res.status(401).json({ success: false, error: "Signature does not match wallet" });
			return;
		}
	} catch {
		res.status(401).json({ success: false, error: "Invalid signature" });
		return;
	}

	// Mark challenge as used
	challenge.usedAt = Date.now();

	// Create session
	const sessionId = uuidv4();
	const expiresAt = Date.now() + SESSION_VALIDITY_MS;
	authSessions.set(sessionId, { id: sessionId, walletAddress: wallet, expiresAt });

	const expDate = new Date(expiresAt).toUTCString();
	res.setHeader(
		"Set-Cookie",
		`${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Expires=${expDate}`,
	);
	console.log(`[Auth Session] ${wallet} session=${sessionId}`);
	res.json({ success: true, walletAddress: wallet });
});

// GET /api/me – return authenticated wallet from session cookie
app.get("/api/me", (req, res) => {
	const cookies = parseCookies(req.headers.cookie);
	const sessionId = cookies[SESSION_COOKIE_NAME];
	if (!sessionId) {
		res.status(401).json({ success: false, error: "Authentication required" });
		return;
	}
	const session = authSessions.get(sessionId);
	if (!session || session.expiresAt < Date.now()) {
		res.status(401).json({ success: false, error: "Authentication required" });
		return;
	}
	res.json({ success: true, walletAddress: session.walletAddress });
});

// ============ Agent API ============

// Create new intent (called by agents)
app.post("/api/intents", (req, res) => {
	try {
		const body = req.body as CreateIntentRequest & { userId?: string };

		// For hackathon, accept userId in body or default to 'demo'
		const userId = body.userId || "demo-user";

		// Validate required fields
		if (!body.agentId || !body.details) {
			res.status(400).json({ success: false, error: "Missing required fields" });
			return;
		}

		const intent = createIntent(body, userId);
		intents.set(intent.id, intent);

		console.log(
			`[Intent Created] ${intent.id} by ${intent.agentName}: ${intent.details.amount} ${intent.details.token} to ${intent.details.recipient}`,
		);

		res.status(201).json({ success: true, intent });
	} catch (error) {
		console.error("Error creating intent:", error);
		res.status(500).json({ success: false, error: "Internal server error" });
	}
});

// Get intent status (for agents to poll)
app.get("/api/intents/:id", (req, res) => {
	const intent = intents.get(req.params.id);

	if (!intent) {
		res.status(404).json({ success: false, error: "Intent not found" });
		return;
	}

	res.json({ success: true, intent });
});

// List intents for a user (used by the Live App)
// Mirrors the Vercel serverless function: GET /api/intents?userId=...&status=...&limit=...
app.get("/api/intents", (req, res) => {
	const userId = req.query.userId as string | undefined;

	if (!userId) {
		res.status(400).json({ success: false, error: "Missing required query parameter: userId" });
		return;
	}

	const status = req.query.status as IntentStatus | undefined;
	const limitParam = req.query.limit as string | undefined;
	const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : 50;
	const limit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 50;

	const userIntents = Array.from(intents.values())
		.filter((i) => i.userId === userId)
		.filter((i) => !status || i.status === status)
		.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
		.slice(0, limit);

	res.json({ success: true, intents: userIntents });
});

// ============ Live App API ============

// Get pending intents for a user
app.get("/api/users/:userId/intents", (req, res) => {
	const { userId } = req.params;
	const { status } = req.query;

	const userIntents = Array.from(intents.values())
		.filter((i) => i.userId === userId)
		.filter((i) => !status || i.status === status)
		.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

	res.json({ success: true, intents: userIntents });
});

// Update intent status (POST /api/intents/status – preferred, avoids Vercel dynamic-route issues)
app.post("/api/intents/status", (req, res) => {
	const { id: intentId } = req.body as { id?: string };
	if (!intentId) {
		res.status(400).json({ success: false, error: "Missing intent ID in request body" });
		return;
	}
	const intent = intents.get(intentId);

	if (!intent) {
		res.status(404).json({ success: false, error: "Intent not found" });
		return;
	}

	const { status, txHash, note, paymentSignatureHeader, paymentPayload } = req.body as {
		status: IntentStatus;
		txHash?: string;
		note?: string;
		paymentSignatureHeader?: string;
		paymentPayload?: X402PaymentPayload;
	};

	const now = new Date().toISOString();

	intent.status = status;
	intent.statusHistory.push({ status, timestamp: now, note });

	if (status === "approved") {
		intent.reviewedAt = now;
	} else if (status === "broadcasting" && txHash) {
		intent.broadcastAt = now;
		intent.txHash = txHash;
		intent.txUrl = getExplorerTxUrl(intent.details.chainId, txHash);
	} else if (status === "broadcasting") {
		intent.broadcastAt = now;
	} else if (status === "confirmed") {
		intent.confirmedAt = now;
	} else if (status === "rejected") {
		intent.reviewedAt = now;
	}

	if (paymentSignatureHeader || paymentPayload) {
		const existing = intent.details.x402;
		const base = paymentPayload
			? { resource: paymentPayload.resource, accepted: paymentPayload.accepted }
			: existing;

		if (base) {
			intent.details = {
				...intent.details,
				x402: {
					...base,
					...(existing ?? {}),
					paymentSignatureHeader: paymentSignatureHeader ?? existing?.paymentSignatureHeader,
					paymentPayload: paymentPayload ?? existing?.paymentPayload,
				},
			};
		}
	}

	console.log(`[Intent ${status.toUpperCase()}] ${intent.id}${txHash ? ` tx: ${txHash}` : ""}`);

	res.json({ success: true, intent });
});

// Update intent status (legacy PATCH – kept for backward compat)
app.patch("/api/intents/:id/status", (req, res) => {
	const intent = intents.get(req.params.id);

	if (!intent) {
		res.status(404).json({ success: false, error: "Intent not found" });
		return;
	}

	const { status, txHash, note, paymentSignatureHeader, paymentPayload } = req.body as {
		status: IntentStatus;
		txHash?: string;
		note?: string;
		paymentSignatureHeader?: string;
		paymentPayload?: X402PaymentPayload;
	};

	const now = new Date().toISOString();

	intent.status = status;
	intent.statusHistory.push({ status, timestamp: now, note });

	if (status === "approved") {
		intent.reviewedAt = now;
	} else if (status === "broadcasting" && txHash) {
		intent.broadcastAt = now;
		intent.txHash = txHash;
		// Generate explorer link using shared helper
		intent.txUrl = getExplorerTxUrl(intent.details.chainId, txHash);
	} else if (status === "broadcasting") {
		intent.broadcastAt = now;
	} else if (status === "confirmed") {
		intent.confirmedAt = now;
	} else if (status === "rejected") {
		intent.reviewedAt = now;
	}

	// Persist x402 proof data inside the details blob if provided
	if (paymentSignatureHeader || paymentPayload) {
		const existing = intent.details.x402;
		const base = paymentPayload
			? { resource: paymentPayload.resource, accepted: paymentPayload.accepted }
			: existing;

		if (base) {
			intent.details = {
				...intent.details,
				x402: {
					...base,
					...(existing ?? {}),
					paymentSignatureHeader: paymentSignatureHeader ?? existing?.paymentSignatureHeader,
					paymentPayload: paymentPayload ?? existing?.paymentPayload,
				},
			};
		}
	}

	console.log(`[Intent ${status.toUpperCase()}] ${intent.id}${txHash ? ` tx: ${txHash}` : ""}`);

	res.json({ success: true, intent });
});

// ============ Agent Provisioning ============

// Register a new agent (with device signature verification)
app.post("/api/agents/register", async (req, res) => {
	try {
		const { trustChainId, agentPublicKey, agentLabel, authorizationSignature } = req.body as {
			trustChainId?: string;
			agentPublicKey?: string;
			agentLabel?: string;
			authorizationSignature?: string;
		};

		if (!trustChainId || !agentPublicKey || !authorizationSignature) {
			res.status(400).json({
				success: false,
				error: "Missing required fields: trustChainId, agentPublicKey, authorizationSignature",
			});
			return;
		}

		const pubkey = agentPublicKey.toLowerCase();
		const label = agentLabel || "Unnamed Agent";

		// Verify device authorization signature (EIP-191 personal_sign)
		try {
			const { recoverMessageAddress } = await import("viem");
			const message = [
				"Authorize agent key for Ledger Agent Payments",
				`Key: ${agentPublicKey}`,
				`Label: ${label}`,
				`Identity: ${trustChainId}`,
			].join("\n");

			const recovered = await recoverMessageAddress({
				message,
				signature: authorizationSignature as `0x${string}`,
			});

			if (recovered.toLowerCase() !== trustChainId.toLowerCase()) {
				res.status(403).json({
					success: false,
					error: "Authorization signature does not match the connected wallet",
				});
				return;
			}
		} catch (err) {
			console.error("[Agent Registration] Signature verification failed:", err);
			res.status(400).json({ success: false, error: "Invalid authorization signature" });
			return;
		}

		const existing = Array.from(agents.values()).find(
			(a) => a.memberPubkey === pubkey && !a.revokedAt,
		);
		if (existing) {
			res
				.status(409)
				.json({ success: false, error: "This agent public key is already registered" });
			return;
		}

		const member: TrustchainMember = {
			id: uuidv4(),
			trustchainId: trustChainId.toLowerCase(),
			memberPubkey: pubkey,
			role: "agent_write_only",
			label,
			createdAt: new Date().toISOString(),
			revokedAt: null,
		};
		agents.set(member.id, member);

		console.log(
			`[Agent Registered] ${member.id} "${member.label}" for trustchain ${member.trustchainId} (device-authorized)`,
		);
		res.status(201).json({ success: true, member });
	} catch (error) {
		console.error("Error registering agent:", error);
		res.status(500).json({ success: false, error: "Internal server error" });
	}
});

// List agents for a trustchain
app.get("/api/agents", (req, res) => {
	const trustchainId = ((req.query.trustchainId as string) || "").toLowerCase();
	if (!trustchainId) {
		res
			.status(400)
			.json({ success: false, error: "Missing required query parameter: trustchainId" });
		return;
	}

	const members = Array.from(agents.values()).filter((a) => a.trustchainId === trustchainId);
	res.json({ success: true, members });
});

// Get agent by ID
app.get("/api/agents/:id", (req, res) => {
	const member = agents.get(req.params.id);
	if (!member) {
		res.status(404).json({ success: false, error: "Agent not found" });
		return;
	}
	res.json({ success: true, member });
});

// Revoke agent (POST /api/agents/revoke – preferred, avoids Vercel dynamic-route issues)
// Requires a Ledger-signed revocation message (signature field in body).
app.post("/api/agents/revoke", (req, res) => {
	const { id, signature } = req.body as { id?: string; signature?: string };
	if (!id) {
		res.status(400).json({ success: false, error: "Missing agent ID in request body" });
		return;
	}
	if (!signature) {
		res.status(400).json({ success: false, error: "Missing signature in request body" });
		return;
	}
	const member = agents.get(id);
	if (!member || member.revokedAt) {
		res.status(404).json({ success: false, error: "Agent not found or already revoked" });
		return;
	}
	// NOTE: In-memory dev backend skips actual signature verification.
	// The Vercel serverless function (apps/web/api/agents/revoke.ts) does full verification.
	member.revokedAt = new Date().toISOString();
	console.log(`[Agent Revoked] ${member.id} "${member.label}"`);
	res.json({ success: true, member });
});

// Revoke agent (legacy DELETE – kept for backward compat)
app.delete("/api/agents/:id", (req, res) => {
	const member = agents.get(req.params.id);
	if (!member || member.revokedAt) {
		res.status(404).json({ success: false, error: "Agent not found or already revoked" });
		return;
	}
	member.revokedAt = new Date().toISOString();
	console.log(`[Agent Revoked] ${member.id} "${member.label}"`);
	res.json({ success: true, member });
});

// ============ MCP Market Context Signing ============

// TLV tag constants (must match C device code)
const MCP_TAG = {
	STRUCT_TYPE: 0x01,
	STRUCT_VERSION: 0x02,
	CHAIN_ID: 0x23,
	TOKEN_ID: 0x60,
	ISSUED_AT: 0x61,
	EXPIRES_AT: 0x62,
	ATTESTER_ID: 0x63,
	MARKET_NAME: 0x64,
	MARKET_OUTCOME: 0x65,
	MARKET_AMOUNT: 0x66,
	MARKET_SHARES: 0x67,
	MARKET_PRICE: 0x68,
	DER_SIGNATURE: 0x15,
} as const;

function tlvField(tag: number, value: Buffer): Buffer {
	const tagBuf = Buffer.alloc(1);
	tagBuf.writeUInt8(tag);
	const len = value.length;
	let lenBuf: Buffer;
	if (len < 0x80) {
		lenBuf = Buffer.alloc(1);
		lenBuf.writeUInt8(len);
	} else if (len <= 0xff) {
		lenBuf = Buffer.from([0x81, len]);
	} else {
		lenBuf = Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
	}
	return Buffer.concat([tagBuf, lenBuf, value]);
}

// Load the MCP attester private key from the device_app keychain
const MCP_PEM_PATH = resolve(
	import.meta.dirname,
	"../../../device_app/client/src/ledger_app_clients/ethereum/keychain/polymarket_mcp.pem",
);
let mcpPrivKeyPem: string | null = null;
try {
	mcpPrivKeyPem = readFileSync(MCP_PEM_PATH, "utf-8");
} catch {
	console.warn(`[MCP] Could not load attester key from ${MCP_PEM_PATH}`);
}

app.post("/api/market-context/sign", (req, res) => {
	const { tokenId, chainId, marketName, marketOutcome, marketAmount, marketShares, marketPrice } =
		req.body;
	if (
		!tokenId ||
		!chainId ||
		!marketName ||
		!marketOutcome ||
		!marketAmount ||
		!marketShares ||
		!marketPrice
	) {
		res.status(400).json({ error: "Missing required fields" });
		return;
	}

	if (!mcpPrivKeyPem) {
		res.status(500).json({ error: "Attester key not configured" });
		return;
	}

	const now = Math.floor(Date.now() / 1000);
	const expiresAt = now + 300;

	const tokenIdBuf = Buffer.from(BigInt(tokenId).toString(16).padStart(64, "0"), "hex");
	const chainIdBuf = Buffer.alloc(8);
	chainIdBuf.writeBigUInt64BE(BigInt(chainId));
	const issuedAtBuf = Buffer.alloc(4);
	issuedAtBuf.writeUInt32BE(now);
	const expiresAtBuf = Buffer.alloc(4);
	expiresAtBuf.writeUInt32BE(expiresAt);

	let payload = Buffer.concat([
		tlvField(MCP_TAG.STRUCT_TYPE, Buffer.from([0x0a])),
		tlvField(MCP_TAG.STRUCT_VERSION, Buffer.from([0x01])),
		tlvField(MCP_TAG.CHAIN_ID, chainIdBuf),
		tlvField(MCP_TAG.TOKEN_ID, tokenIdBuf),
		tlvField(MCP_TAG.ISSUED_AT, issuedAtBuf),
		tlvField(MCP_TAG.EXPIRES_AT, expiresAtBuf),
		tlvField(MCP_TAG.ATTESTER_ID, Buffer.from([0x00])),
		tlvField(MCP_TAG.MARKET_NAME, Buffer.from(String(marketName).slice(0, 128))),
		tlvField(MCP_TAG.MARKET_OUTCOME, Buffer.from(String(marketOutcome).slice(0, 16))),
		tlvField(MCP_TAG.MARKET_AMOUNT, Buffer.from(String(marketAmount).slice(0, 32))),
		tlvField(MCP_TAG.MARKET_SHARES, Buffer.from(String(marketShares).slice(0, 32))),
		tlvField(MCP_TAG.MARKET_PRICE, Buffer.from(String(marketPrice).slice(0, 32))),
	]);

	const sign = createSign("SHA256");
	sign.update(payload);
	const sig = sign.sign(mcpPrivKeyPem);

	payload = Buffer.concat([payload, tlvField(MCP_TAG.DER_SIGNATURE, sig)]);

	console.log(
		`[MCP Sign] market="${marketName}" outcome=${marketOutcome} shares=${marketShares} price=${marketPrice} total=${marketAmount}`,
	);
	res.json({ payload: payload.toString("hex") });
});

// ============ Polymarket CLOB Credentials ============

interface PolymarketCredentials {
	apiKey: string;
	secret: string;
	passphrase: string;
}
const polymarketCreds = new Map<string, PolymarketCredentials>();

// Save credentials (after user derives API key via Ledger signature)
app.post("/api/polymarket/credentials", (req, res) => {
	const cookies = parseCookies(req.headers.cookie);
	const sessionId = cookies[SESSION_COOKIE_NAME];
	const session = sessionId ? authSessions.get(sessionId) : undefined;
	if (!session || session.expiresAt < Date.now()) {
		res.status(401).json({ success: false, error: "Authentication required" });
		return;
	}
	const { apiKey, secret, passphrase } = req.body as Partial<PolymarketCredentials>;
	if (!apiKey || !secret || !passphrase) {
		res.status(400).json({ success: false, error: "Missing apiKey, secret, or passphrase" });
		return;
	}
	polymarketCreds.set(session.walletAddress, { apiKey, secret, passphrase });
	console.log(`[Polymarket] Credentials saved for ${session.walletAddress}`);
	res.json({ success: true });
});

// Check if credentials exist for the authenticated user
app.get("/api/polymarket/credentials", (req, res) => {
	const cookies = parseCookies(req.headers.cookie);
	const sessionId = cookies[SESSION_COOKIE_NAME];
	const session = sessionId ? authSessions.get(sessionId) : undefined;
	if (!session || session.expiresAt < Date.now()) {
		res.status(401).json({ success: false, error: "Authentication required" });
		return;
	}
	const creds = polymarketCreds.get(session.walletAddress);
	res.json({ success: true, connected: !!creds });
});

// Delete credentials
app.delete("/api/polymarket/credentials", (req, res) => {
	const cookies = parseCookies(req.headers.cookie);
	const sessionId = cookies[SESSION_COOKIE_NAME];
	const session = sessionId ? authSessions.get(sessionId) : undefined;
	if (!session || session.expiresAt < Date.now()) {
		res.status(401).json({ success: false, error: "Authentication required" });
		return;
	}
	polymarketCreds.delete(session.walletAddress);
	console.log(`[Polymarket] Credentials removed for ${session.walletAddress}`);
	res.json({ success: true });
});

// ============ Demo/Debug ============

// List all intents (debug endpoint)
app.get("/api/debug/intents", (_req, res) => {
	res.json({
		success: true,
		count: intents.size,
		intents: Array.from(intents.values()),
	});
});

// Clear all intents (debug endpoint)
app.delete("/api/debug/intents", (_req, res) => {
	intents.clear();
	res.json({ success: true, message: "All intents cleared" });
});

// Start server
app.listen(PORT, () => {
	console.log(`
╔═══════════════════════════════════════════════════════════╗
║           AGENT INTENTS BACKEND                           ║
║                                                           ║
║  "Agents propose, humans sign with hardware."             ║
║                                                           ║
║  Server running on http://localhost:${PORT}                 ║
║                                                           ║
║  Endpoints:                                               ║
║    POST   /api/intents              Create intent         ║
║    GET    /api/intents/:id          Get intent status     ║
║    GET    /api/users/:userId/intents  List user intents   ║
║    PATCH  /api/intents/:id/status   Update status         ║
║    POST   /api/agents/register      Register agent        ║
║    GET    /api/agents               List agents           ║
║    GET    /api/agents/:id           Get agent             ║
║    DELETE /api/agents/:id           Revoke agent          ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
