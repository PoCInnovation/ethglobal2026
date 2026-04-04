/**
 * Submit signed Polymarket orders to the CLOB API.
 *
 * Fetches L2 credentials from our backend, builds HMAC headers,
 * and POSTs the order to clob.polymarket.com.
 */

const CLOB_API = "https://clob.polymarket.com";
const API_BASE = "";

interface StoredCredentials {
	apiKey: string;
	secret: string;
	passphrase: string;
}

async function getStoredCredentials(): Promise<StoredCredentials | null> {
	try {
		const res = await fetch(`${API_BASE}/api/polymarket/credentials/full`, {
			credentials: "include",
		});
		if (!res.ok) return null;
		const data = await res.json();
		if (!data.success || !data.credentials) return null;
		return data.credentials;
	} catch {
		return null;
	}
}

async function buildHmacSignature(
	secret: string,
	timestamp: string,
	method: string,
	requestPath: string,
	body?: string,
): Promise<string> {
	const message = `${timestamp}${method}${requestPath}${body ?? ""}`;
	const encoder = new TextEncoder();
	const keyBytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
	const key = await crypto.subtle.importKey(
		"raw",
		keyBytes,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
	const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
	return b64.replace(/\+/g, "-").replace(/\//g, "_");
}

export interface SubmitOrderResult {
	success: boolean;
	orderID?: string;
	status?: string;
	errorMsg?: string;
}

/**
 * Submit a signed order to the Polymarket CLOB.
 *
 * @param order - The order message fields (from EIP-712 message)
 * @param signature - The EIP-712 signature from the Ledger
 * @param walletAddress - The maker's wallet address
 */
export async function submitSignedOrder(
	order: Record<string, string>,
	signature: string,
	walletAddress: string,
): Promise<SubmitOrderResult> {
	const creds = await getStoredCredentials();
	if (!creds) {
		return { success: false, errorMsg: "Polymarket credentials not found. Connect in Settings." };
	}

	const requestPath = "/order";
	const timestamp = Math.floor(Date.now() / 1000).toString();

	const orderBody = JSON.stringify({
		order: {
			salt: Number(order.salt),
			maker: order.maker,
			signer: order.signer,
			taker: order.taker,
			tokenId: order.tokenId,
			makerAmount: order.makerAmount,
			takerAmount: order.takerAmount,
			expiration: order.expiration,
			nonce: order.nonce,
			feeRateBps: order.feeRateBps,
			side: Number(order.side),
			signatureType: Number(order.signatureType),
			signature,
		},
		owner: walletAddress,
		orderType: "GTC",
	});

	const hmacSig = await buildHmacSignature(
		creds.secret,
		timestamp,
		"POST",
		requestPath,
		orderBody,
	);

	const res = await fetch(`${CLOB_API}${requestPath}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			POLY_ADDRESS: walletAddress,
			POLY_API_KEY: creds.apiKey,
			POLY_PASSPHRASE: creds.passphrase,
			POLY_SIGNATURE: hmacSig,
			POLY_TIMESTAMP: timestamp,
		},
		body: orderBody,
	});

	const data = await res.json().catch(() => ({}));

	if (!res.ok) {
		console.error("[CLOB] Order submission failed:", res.status, data);
		return {
			success: false,
			errorMsg: data?.error || data?.message || `CLOB error ${res.status}`,
		};
	}

	console.log("[CLOB] Order submitted:", data);
	return {
		success: true,
		orderID: data.orderID ?? data.id,
		status: data.status,
	};
}
