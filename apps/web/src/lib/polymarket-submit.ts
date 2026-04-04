/**
 * Submit signed Polymarket orders to the CLOB API via backend proxy.
 *
 * The browser cannot POST directly to clob.polymarket.com (CORS).
 * Instead, we send the order to our backend which adds HMAC auth headers
 * and proxies the request.
 */

const API_BASE = "";

/**
 * Check if Polymarket CLOB credentials are available (fast check, no secrets returned).
 */
export async function checkPolymarketConnection(): Promise<boolean> {
	try {
		const res = await fetch(`${API_BASE}/api/polymarket/credentials`, {
			credentials: "include",
		});
		if (!res.ok) return false;
		const data = await res.json();
		return data?.connected === true;
	} catch {
		return false;
	}
}

export interface SubmitOrderResult {
	success: boolean;
	orderID?: string;
	status?: string;
	errorMsg?: string;
}

/**
 * Submit a signed order to the Polymarket CLOB via backend proxy.
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
	console.log("[CLOB] ========== ORDER SUBMISSION START ==========");
	console.log("[CLOB] Wallet:", walletAddress);
	console.log("[CLOB] Order fields:", JSON.stringify(order, null, 2));
	console.log("[CLOB] Signature:", signature);

	// Build the CLOB order body (same format as Polymarket SDK)
	const sideStr = Number(order.side) === 0 ? "BUY" : "SELL";

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
			side: sideStr,
			signatureType: Number(order.signatureType),
			signature,
		},
		owner: walletAddress,
		orderType: "GTC",
	});

	console.log("[CLOB] Order body:", orderBody);

	// Submit via backend proxy (avoids CORS, backend adds HMAC headers)
	try {
		console.log("[CLOB] Submitting via backend proxy...");
		const res = await fetch(`${API_BASE}/api/polymarket/order`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ orderBody, walletAddress }),
		});

		const data = await res.json().catch(() => ({ error: "Invalid response" }));
		console.log("[CLOB] Proxy response:", res.status, JSON.stringify(data));

		if (!res.ok || !data.success) {
			const errorMsg = data?.error || data?.message || `CLOB error ${res.status}`;
			console.error("[CLOB] FAILED:", errorMsg);
			if (data?.raw) console.error("[CLOB] Raw CLOB response:", data.raw);
			console.log("[CLOB] ========== ORDER SUBMISSION FAILED ==========");
			return { success: false, errorMsg };
		}

		console.log("[CLOB] SUCCESS! OrderID:", data.orderID ?? data.id);
		console.log("[CLOB] Status:", data.status);
		console.log("[CLOB] ========== ORDER SUBMISSION SUCCESS ==========");
		return {
			success: true,
			orderID: data.orderID ?? data.id,
			status: data.status,
		};
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : "Network error";
		console.error("[CLOB] NETWORK ERROR:", errorMsg);
		console.log("[CLOB] ========== ORDER SUBMISSION NETWORK ERROR ==========");
		return { success: false, errorMsg };
	}
}
