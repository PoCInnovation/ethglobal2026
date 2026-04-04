/**
 * Agent Payments with Ledger Backend Service
 *
 * REST API for:
 * - Agents to submit transaction intents
 * - Live App to fetch pending intents
 * - Status updates when intents are signed/rejected
 * - Polymarket scanner + Agent Council deliberations
 */

// Load shared .env from web app (contains GEMINI_API_KEY, etc.)
import { readFileSync as _readEnv } from "node:fs";
import { resolve as _resolveEnv } from "node:path";
try {
	const envPath = _resolveEnv(import.meta.dirname ?? ".", "../../web/.env");
	const envContent = _readEnv(envPath, "utf-8");
	for (const line of envContent.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		let val = trimmed.slice(eqIdx + 1).trim();
		// Strip quotes
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		if (!process.env[key]) {
			process.env[key] = val;
		}
	}
	console.log(`[Env] Loaded shared env from ${envPath}`);
} catch {
	// No shared .env found, that's OK — env vars should be set externally
}

import {
	type CreateIntentRequest,
	type Intent,
	type IntentStatus,
	type PolymarketTradeDetails,
	type X402PaymentPayload,
	getExplorerTxUrl,
} from "@agent-intents/shared";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import cors from "cors";
import express from "express";
import { v4 as uuidv4 } from "uuid";
import { scanMarkets, getMarketDetails } from "./polymarket-scanner.js";
import {
	deliberateAndPropose,
	deliberate,
	getDeliberation,
	listDeliberations,
	type ProposedTrade,
} from "./agent-council.js";

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
		`${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; Expires=${expDate}`,
	);
	console.log(`[Auth Session] ${wallet} session=${sessionId}`);
	res.json({ success: true, walletAddress: wallet });
});

// GET /api/me – return authenticated wallet from session cookie
// Always 200 + JSON so the browser does not log a failed fetch on first visit (no cookie yet).
app.get("/api/me", (req, res) => {
	const cookies = parseCookies(req.headers.cookie);
	const sessionId = cookies[SESSION_COOKIE_NAME];
	if (!sessionId) {
		res.json({ success: false, error: "Authentication required" });
		return;
	}
	const session = authSessions.get(sessionId);
	if (!session || session.expiresAt < Date.now()) {
		res.json({ success: false, error: "Authentication required" });
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

		const d = intent.details;
		const logDetails = d.type === "transfer"
			? `${d.amount} ${d.token} to ${d.recipient}`
			: `${d.type}: ${d.amount}`;
		console.log(`[Intent Created] ${intent.id} by ${intent.agentName}: ${logDetails}`);

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
		.filter((i) => i.userId === userId || i.userId === "polymarket-scanner")
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

	if ((paymentSignatureHeader || paymentPayload) && intent.details.type === "transfer") {
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
	if ((paymentSignatureHeader || paymentPayload) && intent.details.type === "transfer") {
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
	MARKET_SIDE: 0x69,
	AUTH_LABEL: 0x70,
	AUTH_ADDRESS: 0x71,
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
	if (!mcpPrivKeyPem) {
		res.status(500).json({ error: "Attester key not configured" });
		return;
	}

	const { type } = req.body;
	let payload: Buffer;

	if (type === "auth") {
		const { chainId, label, address } = req.body;
		if (!chainId || !label || !address) {
			res.status(400).json({ error: "Missing required auth fields" });
			return;
		}

		const now = Math.floor(Date.now() / 1000);
		const expiresAt = now + 300;

		const chainIdBuf = Buffer.alloc(8);
		chainIdBuf.writeBigUInt64BE(BigInt(chainId));
		const issuedAtBuf = Buffer.alloc(4);
		issuedAtBuf.writeUInt32BE(now);
		const expiresAtBuf = Buffer.alloc(4);
		expiresAtBuf.writeUInt32BE(expiresAt);

		payload = Buffer.concat([
			tlvField(MCP_TAG.STRUCT_TYPE, Buffer.from([0x0b])),
			tlvField(MCP_TAG.STRUCT_VERSION, Buffer.from([0x01])),
			tlvField(MCP_TAG.CHAIN_ID, chainIdBuf),
			tlvField(MCP_TAG.ISSUED_AT, issuedAtBuf),
			tlvField(MCP_TAG.EXPIRES_AT, expiresAtBuf),
			tlvField(MCP_TAG.AUTH_LABEL, Buffer.from(String(label).slice(0, 64))),
			tlvField(MCP_TAG.AUTH_ADDRESS, Buffer.from(String(address).slice(0, 42))),
		]);

		console.log(`[MCP Sign] auth label="${label}" address=${address}`);
	} else {
		const { tokenId, chainId, marketName, marketOutcome, marketAmount, marketShares, marketPrice, marketSide } =
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

		const now = Math.floor(Date.now() / 1000);
		const expiresAt = now + 300;

		const tokenIdBuf = Buffer.from(BigInt(tokenId).toString(16).padStart(64, "0"), "hex");
		const chainIdBuf = Buffer.alloc(8);
		chainIdBuf.writeBigUInt64BE(BigInt(chainId));
		const issuedAtBuf = Buffer.alloc(4);
		issuedAtBuf.writeUInt32BE(now);
		const expiresAtBuf = Buffer.alloc(4);
		expiresAtBuf.writeUInt32BE(expiresAt);

		payload = Buffer.concat([
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
			tlvField(MCP_TAG.MARKET_SIDE, Buffer.from(String(marketSide || "Buy").slice(0, 16))),
		]);

		console.log(
			`[MCP Sign] market="${marketName}" outcome=${marketOutcome} side=${marketSide} shares=${marketShares} price=${marketPrice} total=${marketAmount}`,
		);
	}

	const sign = createSign("SHA256");
	sign.update(payload);
	const sig = sign.sign(mcpPrivKeyPem);

	payload = Buffer.concat([payload, tlvField(MCP_TAG.DER_SIGNATURE, sig)]);

	res.json({ payload: payload.toString("hex") });
});

// ============ Polymarket Market Lookup Proxy ============

// Proxy Gamma API requests to avoid browser CORS issues
app.get("/api/polymarket/market-lookup", async (req, res) => {
	const tokenId = req.query.tokenId as string;
	if (!tokenId) {
		res.status(400).json({ error: "Missing tokenId" });
		return;
	}
	try {
		const gammaRes = await fetch(
			`https://gamma-api.polymarket.com/markets?clob_token_ids=${tokenId}`,
		);
		if (!gammaRes.ok) {
			res.status(gammaRes.status).json({ error: "Gamma API error" });
			return;
		}
		const data = await gammaRes.json();
		res.json(data);
	} catch (err) {
		console.error("[Polymarket] Market lookup failed:", err);
		res.status(500).json({ error: "Market lookup failed" });
	}
});

// Get latest price + market info for a token (simulation before signing)
app.get("/api/polymarket/simulate", async (req, res) => {
	const tokenId = req.query.tokenId as string;
	if (!tokenId) {
		res.status(400).json({ error: "Missing tokenId" });
		return;
	}
	try {
		// Fetch from Gamma API to get negRisk + current price
		const gammaRes = await fetch(
			`https://gamma-api.polymarket.com/markets?clob_token_ids=${tokenId}`,
		);
		if (!gammaRes.ok) {
			res.status(gammaRes.status).json({ error: "Gamma API error" });
			return;
		}
		const markets = await gammaRes.json();
		if (!Array.isArray(markets) || markets.length === 0) {
			res.status(404).json({ error: "Market not found" });
			return;
		}
		const market = markets[0];

		// Parse clobTokenIds and outcomePrices
		const clobTokenIds: string[] = typeof market.clobTokenIds === "string"
			? JSON.parse(market.clobTokenIds) : market.clobTokenIds ?? [];
		const outcomes: string[] = typeof market.outcomes === "string"
			? JSON.parse(market.outcomes) : market.outcomes ?? [];
		const outcomePrices: string[] = typeof market.outcomePrices === "string"
			? JSON.parse(market.outcomePrices) : market.outcomePrices ?? [];

		const tokenIndex = clobTokenIds.findIndex((id: string) => id === tokenId);
		const outcome = tokenIndex >= 0 ? outcomes[tokenIndex] ?? "UNKNOWN" : "UNKNOWN";
		const price = tokenIndex >= 0 ? Number.parseFloat(outcomePrices[tokenIndex] ?? "0") : 0;

		// Determine negRisk from Gamma API
		const negRisk = market.negRisk === true || market.negRisk === "true";

		// Get authoritative tick size from CLOB API (Gamma's minimum_tick_size is unreliable)
		let tickSize = "0.01"; // fallback
		try {
			const tickRes = await fetch(`https://clob.polymarket.com/tick-size?token_id=${tokenId}`);
			if (tickRes.ok) {
				const tickData = await tickRes.json();
				tickSize = tickData?.minimum_tick_size ?? tickData ?? "0.01";
				if (typeof tickSize === "number") tickSize = String(tickSize);
			}
		} catch {
			// fallback to Gamma or default
			tickSize = market.minimum_tick_size ?? "0.01";
		}

		console.log(`[Simulate] tokenId=${tokenId} price=${price} outcome=${outcome} negRisk=${negRisk} tickSize=${tickSize}`);

		res.json({
			tokenId,
			question: market.question ?? market.title ?? "Unknown Market",
			outcome,
			price,
			negRisk,
			tickSize,
		});
	} catch (err) {
		console.error("[Polymarket] Simulate failed:", err);
		res.status(500).json({ error: "Simulation failed" });
	}
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

// Get full credentials (for order submission)
app.get("/api/polymarket/credentials/full", (req, res) => {
	const cookies = parseCookies(req.headers.cookie);
	const sessionId = cookies[SESSION_COOKIE_NAME];
	const session = sessionId ? authSessions.get(sessionId) : undefined;
	if (!session || session.expiresAt < Date.now()) {
		res.status(401).json({ success: false, error: "Authentication required" });
		return;
	}
	const creds = polymarketCreds.get(session.walletAddress);
	if (!creds) {
		res.status(404).json({ success: false, error: "No Polymarket credentials" });
		return;
	}
	res.json({ success: true, credentials: creds });
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

// ============ Polymarket CLOB Order Proxy ============
// Proxy order submissions to avoid browser CORS issues with clob.polymarket.com

app.post("/api/polymarket/order", async (req, res) => {
	const cookies = parseCookies(req.headers.cookie);
	const sessionId = cookies[SESSION_COOKIE_NAME];
	const session = sessionId ? authSessions.get(sessionId) : undefined;
	if (!session || session.expiresAt < Date.now()) {
		res.status(401).json({ success: false, error: "Authentication required" });
		return;
	}

	const creds = polymarketCreds.get(session.walletAddress);
	if (!creds) {
		res.status(400).json({ success: false, error: "No Polymarket credentials. Connect in Settings." });
		return;
	}

	const { orderBody, walletAddress } = req.body as { orderBody: string; walletAddress: string };
	if (!orderBody || !walletAddress) {
		res.status(400).json({ success: false, error: "Missing orderBody or walletAddress" });
		return;
	}

	// Fix the 'owner' field: Polymarket SDK sets owner = API key, not wallet address
	let fixedOrderBody: string;
	try {
		const parsed = JSON.parse(orderBody);
		parsed.owner = creds.apiKey;
		fixedOrderBody = JSON.stringify(parsed);
	} catch {
		res.status(400).json({ success: false, error: "Invalid orderBody JSON" });
		return;
	}

	console.log(`[CLOB Proxy] Fixed owner from ${walletAddress} to API key ${creds.apiKey.slice(0, 8)}...`);

	// Build HMAC signature server-side (using the fixed body)
	const timestamp = Math.floor(Date.now() / 1000).toString();
	const requestPath = "/order";
	const message = `${timestamp}POST${requestPath}${fixedOrderBody}`;

	const crypto = await import("node:crypto");
	const hmac = crypto.createHmac("sha256", Buffer.from(creds.secret, "base64"));
	hmac.update(message);
	const hmacSig = hmac.digest("base64").replace(/\+/g, "-").replace(/\//g, "_");

	const clobUrl = `https://clob.polymarket.com${requestPath}`;
	console.log(`[CLOB Proxy] Submitting order for ${walletAddress}`);
	console.log(`[CLOB Proxy] POST body: ${fixedOrderBody}`);

	try {
		const clobRes = await fetch(clobUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				POLY_ADDRESS: walletAddress,
				POLY_API_KEY: creds.apiKey,
				POLY_PASSPHRASE: creds.passphrase,
				POLY_SIGNATURE: hmacSig,
				POLY_TIMESTAMP: timestamp,
			},
			body: fixedOrderBody,
		});

		const responseText = await clobRes.text();
		console.log(`[CLOB Proxy] Response: ${clobRes.status} ${responseText}`);

		let data: Record<string, unknown> = {};
		try { data = JSON.parse(responseText); } catch { /* not json */ }

		if (!clobRes.ok) {
			res.status(clobRes.status).json({
				success: false,
				error: data?.error || data?.message || `CLOB error ${clobRes.status}`,
				raw: responseText,
			});
			return;
		}

		res.json({ success: true, ...data });
	} catch (err) {
		console.error("[CLOB Proxy] Network error:", err);
		res.status(502).json({ success: false, error: "Failed to reach Polymarket CLOB" });
	}
});

// ============ Polymarket Scanner + Agent Council ============

// List market opportunities with trading signals
app.get("/api/polymarket/opportunities", async (req, res) => {
	try {
		const limit = Number(req.query.limit) || 20;
		const sortBy = (req.query.sortBy as string) || "volume";
		const markets = await scanMarkets({ limit, sortBy: sortBy as any });
		res.json({ success: true, markets });
	} catch (err) {
		console.error("[Scanner] Error:", err);
		res.status(500).json({ success: false, error: "Failed to scan markets" });
	}
});

// ============ Council SSE Deliberation ============
// GET /api/council/deliberate?intentId=...
// Streams deliberation events via Server-Sent Events
app.get("/api/council/deliberate", async (req, res) => {
	console.log(`[Council SSE] Endpoint hit! intentId=${req.query.intentId}`);
	const intentId = req.query.intentId as string | undefined;
	if (!intentId) {
		res.status(400).json({ error: "Missing intentId" });
		return;
	}

	// Find the intent
	const intent = intents.get(intentId);
	if (!intent) {
		console.log(`[Council SSE] Intent ${intentId} not found! Current intents count: ${intents.size}`);
		res.status(404).json({ error: "Intent not found" });
		return;
	}

	if (intent.details.type !== "polymarket_trade") {
		res.status(400).json({ error: "Not a Polymarket trade" });
		return;
	}

	const polyDetails = intent.details as PolymarketTradeDetails;

	// Check if council result already exists (cached)
	const cachedResult = (intent.details as any).councilResult;
	if (cachedResult) {
		res.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
			"X-Accel-Buffering": "no",
		});
		res.write(`data: ${JSON.stringify({ type: "council_cached", payload: cachedResult })}\n\n`);
		res.end();
		return;
	}

	// Setup SSE (charset helps some proxies/browsers accept the stream)
	res.writeHead(200, {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-cache",
		"Connection": "keep-alive",
		"X-Accel-Buffering": "no",
	});

	const send = (type: string, payload: unknown) => {
		if (!res.closed) {
			res.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
		}
	};

	// Agent mapping: our backend roles → frontend agent display
	const agentMap: Record<string, { id: string; name: string; role: string; avatar: string }> = {
		analyst: { id: "bull", name: "Bull Analyst", role: "Market Analysis", avatar: "📊" },
		riskManager: { id: "bear", name: "Risk Manager", role: "Risk Assessment", avatar: "🛡️" },
		contrarian: { id: "quant", name: "Contrarian", role: "Devil's Advocate", avatar: "🔥" },
	};

	// Send council_started
	send("council_started", {
		agents: Object.values(agentMap),
	});

	try {
		// Get market details for the deliberation
		const market = await getMarketDetails(polyDetails.conditionId);
		if (!market) {
			send("error", { fatal: true, message: "Market not found" });
			res.end();
			return;
		}

		// Build context
		const outcomesStr = market.outcomes
			.map((o) => `  - ${o.name}: ${(o.price * 100).toFixed(1)}%`)
			.join("\n");

		const marketContext = `## Trading Opportunity

**Market:** ${market.question}
**Condition ID:** ${market.conditionId}

**Outcomes & Prices:**
${outcomesStr}

**24h Volume:** $${market.volume24h.toLocaleString()}
**Liquidity:** $${market.liquidity.toLocaleString()}
**End Date:** ${market.endDate}
**Signal:** ${market.signal} (strength: ${market.signalStrength}/100)
**Memo:** ${market.memo}

The intent proposes: ${polyDetails.outcome} for ${polyDetails.amount} USDC.

Should we take a position on this market? If so, which outcome and how much?`;

		// Run deliberation with streaming SSE
		const geminiKey = process.env.GEMINI_API_KEY;
		const openaiKey = process.env.OPENAI_API_KEY;
		console.log("[Council SSE] Checking API keys: Gemini=", !!geminiKey, "OpenAI=", !!openaiKey);
		if (!geminiKey && !openaiKey) {
			send("error", { fatal: true, message: "GEMINI_API_KEY or OPENAI_API_KEY required" });
			res.end();
			return;
		}

		const { createLlmOpenAIClient, defaultLlmModel, GEMINI_OPENAI_COMPAT_BASE_URL } =
			await import("./llm-openai-client.js");
		const client = createLlmOpenAIClient();
		const modelName = defaultLlmModel();
		console.log(
			`[Council SSE] model=${modelName}${geminiKey ? ` geminiBase=${GEMINI_OPENAI_COMPAT_BASE_URL}` : ""}`,
		);

		const { SYSTEM_PROMPTS, AGENT_LABELS } = await import("./agent-council.js");

		const agentRoles = ["analyst", "riskManager", "contrarian"] as const;
		const allMessages: Array<{ agent: string; round: number; content: string }> = [];

		// Round 1
		for (const role of agentRoles) {
			const agentInfo = agentMap[role]!;
			console.log(`[Council SSE] Round 1: ${role} starts thinking...`);
			send("agent_thinking", { agentId: agentInfo.id, round: 1 });

			const messages: any[] = [
				{ role: "system", content: SYSTEM_PROMPTS[role] },
				{ role: "user", content: marketContext },
			];

			try {
				console.log(`[Council SSE] Calling client.chat.completions.create for ${role}...`);
				const stream = await client.chat.completions.create({
					model: modelName,
					messages,
					temperature: 0.7,
					max_tokens: 800,
					stream: true,
				});
				console.log(`[Council SSE] Client call successful for ${role}, starting iteration...`);

				let fullContent = "";
				for await (const chunk of stream) {
					const token = chunk.choices[0]?.delta?.content;
					if (token) {
						fullContent += token;
						send("agent_token", { agentId: agentInfo.id, token });
					}
				}
				console.log(`[Council SSE] Stream complete for ${role}`);

				allMessages.push({ agent: role, round: 1, content: fullContent });
				send("agent_message", { agentId: agentInfo.id, round: 1, content: fullContent });
			} catch (err) {
				console.error(`[Council SSE] ${role} error:`, err);
				allMessages.push({ agent: role, round: 1, content: "(Agent error)\nVOTE: ABSTAIN" });
				send("agent_message", { agentId: agentInfo.id, round: 1, content: "(Agent error)\nVOTE: ABSTAIN" });
			}
		}

		// Round 2
		const round1Context = allMessages
			.filter(m => m.round === 1)
			.map(m => `[${AGENT_LABELS[m.agent as keyof typeof AGENT_LABELS]}]: ${m.content}`)
			.join("\n\n---\n\n");

		for (const role of agentRoles) {
			const agentInfo = agentMap[role]!;
			console.log(`[Council SSE] Round 2: ${role} starts thinking...`);
			send("agent_thinking", { agentId: agentInfo.id, round: 2 });

			const otherMessages = allMessages
				.filter(m => m.agent !== role && m.round === 1)
				.map(m => `[${AGENT_LABELS[m.agent as keyof typeof AGENT_LABELS]}]: ${m.content}`)
				.join("\n\n---\n\n");

			const messages: any[] = [
				{ role: "system", content: SYSTEM_PROMPTS[role as keyof typeof SYSTEM_PROMPTS] },
				{ role: "user", content: marketContext },
				{
					role: "user",
					content: `Here are the other council members' opinions:\n\n${otherMessages}\n\nGive your final response for round 2.`,
				},
			];

			try {
				console.log(`[Council SSE] Round 2: Calling client.chat.completions.create for ${role}...`);
				const stream = await client.chat.completions.create({
					model: modelName,
					messages,
					temperature: 0.7,
					max_tokens: 800,
					stream: true,
				});
				console.log(`[Council SSE] Round 2: Client call successful for ${role}, starting iteration...`);

				let fullContent = "";
				for await (const chunk of stream) {
					const token = chunk.choices[0]?.delta?.content;
					if (token) {
						fullContent += token;
						send("agent_token", { agentId: agentInfo.id, token });
					}
				}
				console.log(`[Council SSE] Round 2: Stream complete for ${role}`);

				allMessages.push({ agent: role, round: 2, content: fullContent });
				send("agent_message", { agentId: agentInfo.id, round: 2, content: fullContent });

				// Parse vote
				const voteMatch = /VOTE:\s*(APPROVE|REJECT|ABSTAIN)/i.exec(fullContent);
				const vote = voteMatch?.[1]?.toUpperCase() === "APPROVE" ? "FOR" : voteMatch?.[1]?.toUpperCase() === "REJECT" ? "AGAINST" : "ABSTAIN";
				send("agent_vote", { agentId: agentInfo.id, vote });
			} catch (err) {
				console.error(`[Council SSE] ${role} round 2 error:`, err);
				allMessages.push({ agent: role, round: 2, content: "(Error)\nVOTE: ABSTAIN" });
				send("agent_message", { agentId: agentInfo.id, round: 2, content: "(Error)\nVOTE: ABSTAIN" });
				send("agent_vote", { agentId: agentInfo.id, vote: "ABSTAIN" });
			}
		}

		// Compute votes
		const round2 = allMessages.filter(m => m.round === 2);
		let totalFor = 0, totalAgainst = 0, totalAbstain = 0;
		for (const msg of round2) {
			const voteMatch = /VOTE:\s*(APPROVE|REJECT|ABSTAIN)/i.exec(msg.content);
			const v = voteMatch?.[1]?.toUpperCase();
			if (v === "APPROVE") totalFor++;
			else if (v === "REJECT") totalAgainst++;
			else totalAbstain++;
		}
		const total = totalFor + totalAgainst + totalAbstain;
		const approved = totalFor >= 2;
		const ratio = total > 0 ? totalFor / total : 0;

		const councilResult = {
			approved,
			ratio,
			totalFor,
			totalAgainst,
			totalAbstain,
			summary: approved
				? `Trade approved by council (${totalFor}/${total} votes)`
				: `Trade rejected by council (${totalAgainst}/${total} against)`,
			agents: agentRoles.map(role => {
				const info = agentMap[role]!;
				const rounds = allMessages.filter(m => m.agent === role).map(m => m.content);
				const lastMsg = rounds[rounds.length - 1] || "";
				const voteMatch = /VOTE:\s*(APPROVE|REJECT|ABSTAIN)/i.exec(lastMsg);
				const vote = voteMatch?.[1]?.toUpperCase() === "APPROVE" ? "FOR" : voteMatch?.[1]?.toUpperCase() === "REJECT" ? "AGAINST" : "ABSTAIN";
				return {
					agentId: info.id,
					agentName: info.name,
					role: info.role,
					avatar: info.avatar,
					rounds,
					vote,
				};
			}),
		};

		// Cache result in intent details
		(intent.details as any).councilResult = councilResult;

		send("council_result", councilResult);
		console.log(`[Council SSE] Deliberation complete for ${intentId}: ${approved ? "APPROVED" : "REJECTED"} (${totalFor}/${total})`);
	} catch (err) {
		console.error("[Council SSE] Fatal error:", err);
		send("error", { fatal: true, message: err instanceof Error ? err.message : "Deliberation failed" });
	}

	res.end();
});

// Launch a council deliberation on a market
app.post("/api/polymarket/council/deliberate", async (req, res) => {
	try {
		const { conditionId, outcome, reason } = req.body as {
			conditionId?: string;
			outcome?: string;
			reason?: string;
		};

		if (!conditionId) {
			res.status(400).json({ success: false, error: "Missing conditionId" });
			return;
		}

		const market = await getMarketDetails(conditionId);
		if (!market) {
			res.status(404).json({ success: false, error: "Market not found" });
			return;
		}

		const userReason = outcome
			? `Agent proposes ${outcome} — ${reason || "no reason given"}`
			: reason || "Analyze this opportunity";

		// Intent creation callback — injects into the existing intent queue
		const createIntentFn = (trade: ProposedTrade, mkt: typeof market): string => {
			const now = new Date().toISOString();
			const id = `int_${Date.now()}_${uuidv4().slice(0, 8)}`;

			const selectedOutcome = mkt.outcomes.find(
				(o) => o.name.toLowerCase() === trade.outcome.toLowerCase(),
			);

			const details: PolymarketTradeDetails = {
				type: "polymarket_trade",
				conditionId: mkt.conditionId,
				marketTitle: mkt.question,
				outcome: trade.outcome,
				amount: trade.amount,
				outcomePrice: selectedOutcome?.price,
				tokenId: selectedOutcome?.tokenId,
				chainId: 137,
				memo: trade.reasoning,
			};

			const intent: Intent = {
				id,
				userId: "council-agent",
				agentId: "council",
				agentName: "Agent Council",
				details,
				urgency: "normal",
				status: "pending",
				createdAt: now,
				expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
				statusHistory: [{ status: "pending", timestamp: now }],
			};

			intents.set(id, intent);
			console.log(`[Council] Intent created in queue: ${id}`);
			return id;
		};

		const deliberation = await deliberateAndPropose(market, userReason, createIntentFn);

		res.json({ success: true, deliberation });
	} catch (err) {
		console.error("[Council] Deliberation error:", err);
		res.status(500).json({
			success: false,
			error: err instanceof Error ? err.message : "Deliberation failed",
		});
	}
});

// List all past deliberations
app.get("/api/polymarket/council/deliberations", (_req, res) => {
	res.json({ success: true, deliberations: listDeliberations() });
});

// Get a specific deliberation
app.get("/api/polymarket/council/deliberations/:id", (req, res) => {
	const d = getDeliberation(req.params.id);
	if (!d) {
		res.status(404).json({ success: false, error: "Deliberation not found" });
		return;
	}
	res.json({ success: true, deliberation: d });
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
║  🔮 Polymarket Council:                                   ║
║    GET  /api/polymarket/opportunities  Scan markets       ║
║    POST /api/polymarket/council/deliberate  Deliberate    ║
║    GET  /api/polymarket/council/deliberations  History    ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

	// ============ Auto-Scanner ============
	// Run in background every 60s, creates intents from scan results
	let latestScanResults: Awaited<ReturnType<typeof scanMarkets>> = [];
	let scanRunning = false;

	// Track which conditionIds already have a pending intent (avoid duplicates)
	function getExistingConditionIds(): Set<string> {
		const ids = new Set<string>();
		for (const intent of intents.values()) {
			if (intent.details.type === "polymarket_trade" && intent.status === "pending") {
				ids.add((intent.details as any).conditionId);
			}
		}
		return ids;
	}

	async function runAutoScan() {
		if (scanRunning) {
			console.log("[AutoScan] ⏭️ Skipping — previous scan still running");
			return;
		}
		scanRunning = true;
		try {
			latestScanResults = await scanMarkets({ limit: 10, sortBy: "volume" });
			
			// Create intents for new markets
			const existing = getExistingConditionIds();
			let created = 0;
			for (const market of latestScanResults) {
				if (existing.has(market.conditionId)) continue;
				
				// Pick the best outcome (highest signal)
				const bestOutcome = market.outcomes.reduce((a, b) => a.price > b.price ? a : b);
				
				const id = `int_${Date.now()}_${uuidv4().slice(0, 8)}`;
				const now = new Date().toISOString();
				const intent: Intent = {
					id,
					userId: "polymarket-scanner",
					agentId: "scanner",
					agentName: "Polymarket Scanner",
					details: {
						type: "polymarket_trade" as const,
						conditionId: market.conditionId,
						marketTitle: market.question,
						outcome: bestOutcome.name as "Yes" | "No",
						amount: "50",
						outcomePrice: bestOutcome.price,
						tokenId: bestOutcome.tokenId,
						chainId: 137,
						memo: `${market.signal} (${market.signalStrength}/100) — ${market.memo}`,
					},
					urgency: market.signalStrength > 80 ? "high" : "normal",
					status: "pending",
					createdAt: now,
					expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
					statusHistory: [{ status: "pending", timestamp: now }],
				};
				intents.set(id, intent);
				created++;
				console.log(`[AutoScan] 📝 Created intent ${id} for "${market.question}" (${market.signal})`);
			}
			if (created > 0) {
				console.log(`[AutoScan] ✅ Created ${created} new intents from scan`);
			} else {
				console.log(`[AutoScan] ℹ️ No new markets to create intents for`);
			}
		} catch (err) {
			console.error("[AutoScan] ❌ Error:", err instanceof Error ? err.message : err);
		} finally {
			scanRunning = false;
		}
	}

	// Initial scan after 2s (let server finish startup)
	setTimeout(() => {
		runAutoScan();
	}, 2000);

	// Then every 60s
	setInterval(() => {
		runAutoScan();
	}, 60_000);

	// Expose cached scan results
	app.get("/api/polymarket/scan-cache", (_req, res) => {
		res.json({
			success: true,
			count: latestScanResults.length,
			markets: latestScanResults,
			nextScanIn: "~60s",
		});
	});

	// Manual trigger to scan now
	app.post("/api/polymarket/scan-now", async (_req, res) => {
		await runAutoScan();
		res.json({ success: true, count: latestScanResults.length });
	});
});

