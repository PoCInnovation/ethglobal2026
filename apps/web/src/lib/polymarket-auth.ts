/**
 * Polymarket CLOB API authentication.
 *
 * L1 auth: EIP-712 signature via Ledger to derive API credentials.
 * L2 auth: HMAC-SHA256 headers for authenticated CLOB requests.
 *
 * Credentials are stored server-side, keyed by wallet address.
 */

import { useCallback, useEffect, useState } from "react";
import { useLedger } from "./ledger-provider";

const CLOB_API = "https://clob.polymarket.com";
const API_BASE = import.meta.env.DEV ? import.meta.env.VITE_BACKEND_URL || "" : "";

// ---------- L1 EIP-712 auth types (Polymarket ClobAuth) ----------

const CLOB_AUTH_DOMAIN = {
	name: "ClobAuthDomain",
	version: "1",
	chainId: 137,
} as const;

const CLOB_AUTH_TYPES = {
	EIP712Domain: [
		{ name: "name", type: "string" },
		{ name: "version", type: "string" },
		{ name: "chainId", type: "uint256" },
	],
	ClobAuth: [
		{ name: "address", type: "address" },
		{ name: "timestamp", type: "string" },
		{ name: "nonce", type: "uint256" },
		{ name: "message", type: "string" },
	],
} as const;

const MSG_TO_SIGN = "This message attests that I control the given wallet";

// ---------- L2 HMAC header building ----------

async function buildHmacSignature(
	secret: string,
	timestamp: string,
	method: string,
	requestPath: string,
	body?: string,
): Promise<string> {
	const message = `${timestamp}${method}${requestPath}${body ?? ""}`;
	const encoder = new TextEncoder();

	// Decode base64 secret to raw key bytes
	const keyBytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
	const key = await crypto.subtle.importKey(
		"raw",
		keyBytes,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
	// Base64url encode
	const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
	return b64.replace(/\+/g, "-").replace(/\//g, "_");
}

export interface L2Headers {
	POLY_ADDRESS: string;
	POLY_SIGNATURE: string;
	POLY_TIMESTAMP: string;
	POLY_API_KEY: string;
	POLY_PASSPHRASE: string;
}

// ---------- Hook ----------

export function usePolymarketAuth() {
	const { signTypedDataV4, account, isConnected } = useLedger();
	const [isPolyConnected, setIsPolyConnected] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Check connection status on mount / account change
	useEffect(() => {
		if (!account) {
			setIsPolyConnected(false);
			return;
		}
		fetch(`${API_BASE}/api/polymarket/credentials`, { credentials: "include" })
			.then((r) => r.json())
			.then((data) => setIsPolyConnected(data?.connected === true))
			.catch(() => setIsPolyConnected(false));
	}, [account]);

	/**
	 * Derive Polymarket CLOB API credentials by signing on Ledger,
	 * then store them server-side.
	 */
	const connect = useCallback(async () => {
		if (!account) throw new Error("No wallet connected");
		setIsLoading(true);
		setError(null);

		try {
			const timestamp = Math.floor(Date.now() / 1000).toString();
			const nonce = "0";

			// 1. Sign EIP-712 ClobAuth message on Ledger
			const typedData = {
				domain: { ...CLOB_AUTH_DOMAIN },
				primaryType: "ClobAuth" as const,
				types: { ...CLOB_AUTH_TYPES },
				message: {
					address: account,
					timestamp,
					nonce,
					message: MSG_TO_SIGN,
				},
			};

			const signature = await signTypedDataV4(typedData);

			const l1Headers = {
				POLY_ADDRESS: account,
				POLY_SIGNATURE: signature,
				POLY_TIMESTAMP: timestamp,
				POLY_NONCE: nonce,
			};

			// 2. Try to derive existing API key first, then create if none exists
			let res = await fetch(`${CLOB_API}/auth/derive-api-key`, {
				method: "GET",
				headers: l1Headers,
			});

			if (!res.ok) {
				// No existing key — create a new one
				console.log("[Polymarket] derive-api-key failed, creating new key...");
				res = await fetch(`${CLOB_API}/auth/api-key`, {
					method: "POST",
					headers: l1Headers,
				});
			}

			if (!res.ok) {
				const body = await res.text().catch(() => "");
				throw new Error(`CLOB auth failed (${res.status}): ${body}`);
			}

			const creds = await res.json();
			// Response: { apiKey: string, secret: string, passphrase: string }
			const apiKey = creds.apiKey ?? creds.key;
			const { secret, passphrase } = creds;

			if (!apiKey || !secret || !passphrase) {
				throw new Error("Invalid credentials response from Polymarket");
			}

			console.log("[Polymarket] API key created successfully:", { apiKey: apiKey.slice(0, 8) + "..." });

			// 3. Store credentials server-side
			const saveRes = await fetch(`${API_BASE}/api/polymarket/credentials`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ apiKey, secret, passphrase }),
			});

			if (!saveRes.ok) {
				throw new Error("Failed to save credentials");
			}

			setIsPolyConnected(true);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setError(msg);
			throw err;
		} finally {
			setIsLoading(false);
		}
	}, [account, signTypedDataV4]);

	const disconnect = useCallback(async () => {
		await fetch(`${API_BASE}/api/polymarket/credentials`, {
			method: "DELETE",
			credentials: "include",
		});
		setIsPolyConnected(false);
	}, []);

	return {
		isPolyConnected,
		isLoading,
		error,
		connect,
		disconnect,
	};
}
