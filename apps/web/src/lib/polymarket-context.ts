const API_BASE = "";

// Polymarket CLOB API endpoint
const POLYMARKET_CLOB_API = "https://clob.polymarket.com";

// EIP-712 primaryType for Polymarket orders
const POLYMARKET_PRIMARY_TYPE = "Order";

export interface PolymarketMarketInfo {
  type?: "order";
  tokenId: bigint;
  chainId: number;
  marketName: string;
  marketOutcome: string; // "Yes" or "No"
  marketAmount: string; // e.g., "50.00 USDC"
  marketShares: string; // e.g., "76.92 shares"
  marketPrice: string; // e.g., "0.65 USDC"
  makerAmount: bigint;
  takerAmount: bigint;
  side: number; // 0 = BUY, 1 = SELL
}

/**
 * Returns true if the given EIP-712 typed data is a Polymarket Order.
 */
export function isPolymarketOrder(
  primaryType: string,
  domain: Record<string, unknown>
): boolean {
  return primaryType === POLYMARKET_PRIMARY_TYPE && Number(domain.chainId) === 137;
}

/**
 * Returns true if the given EIP-712 typed data is a ClobAuth message.
 */
export function isClobAuth(
  primaryType: string,
  domain: Record<string, unknown>
): boolean {
  return primaryType === "ClobAuth" && Number(domain.chainId) === 137;
}

export interface AuthContextInfo {
  type: "auth";
  chainId: number;
  label: string;
  address: string;
}

/**
 * Build auth context info from a ClobAuth EIP-712 typed data message.
 */
export function buildAuthContext(
  message: Record<string, unknown>,
  chainId: number
): AuthContextInfo {
  return {
    type: "auth",
    chainId,
    label: "Polymarket",
    address: String(message.address),
  };
}

/**
 * Fetch market metadata from Polymarket CLOB API for a given tokenId.
 */
async function fetchMarketMetadata(
  tokenId: bigint
): Promise<{
  question: string;
  outcome: string;
}> {
  const tokenIdStr = tokenId.toString();

  // Use Gamma API via backend proxy to avoid browser CORS issues
  const url = `${API_BASE}/api/polymarket/market-lookup?tokenId=${tokenIdStr}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Market lookup failed: ${res.status}`);
  }
  const markets = await res.json();
  if (!Array.isArray(markets) || markets.length === 0) {
    throw new Error(`No market found for tokenId ${tokenIdStr}`);
  }
  const market = markets[0];

  // Gamma API uses separate arrays: outcomes, outcomePrices, clobTokenIds
  const clobTokenIds: string[] = typeof market.clobTokenIds === "string"
    ? JSON.parse(market.clobTokenIds)
    : market.clobTokenIds ?? [];
  const outcomes: string[] = typeof market.outcomes === "string"
    ? JSON.parse(market.outcomes)
    : market.outcomes ?? [];
  const tokenIndex = clobTokenIds.findIndex((id: string) => id === tokenIdStr);
  const outcome = tokenIndex >= 0 ? outcomes[tokenIndex] ?? "UNKNOWN" : "UNKNOWN";

  return {
    question: market.question ?? market.title ?? "Unknown Market",
    outcome,
  };
}

/**
 * Build PolymarketMarketInfo from EIP-712 typed data message + off-chain API.
 * Call this before signing a Polymarket order.
 */
export async function buildPolymarketContext(
  message: Record<string, unknown>,
  chainId: number
): Promise<PolymarketMarketInfo> {
  const tokenId = BigInt(message.tokenId as string);
  const makerAmount = BigInt(message.makerAmount as string);
  const takerAmount = BigInt(message.takerAmount as string);
  const side = Number(message.side);

  const { question, outcome } = await fetchMarketMetadata(tokenId);

  // BUY: makerAmount = USDC paid, takerAmount = shares received
  // SELL: makerAmount = shares sold, takerAmount = USDC received
  const usdcAmount = side === 0 ? makerAmount : takerAmount;
  const sharesAmount = side === 0 ? takerAmount : makerAmount;
  const formattedAmount = `${(Number(usdcAmount) / 1_000_000).toFixed(2)} USDC`;
  const formattedShares = `${(Number(sharesAmount) / 1_000_000).toFixed(2)} shares`;
  // Price per share = USDC / shares
  const pricePerShare =
    sharesAmount > 0n
      ? Number(usdcAmount) / Number(sharesAmount)
      : 0;
  const formattedPrice = `${pricePerShare.toFixed(4)} USDC`;

  return {
    tokenId,
    chainId,
    marketName: question.slice(0, 100), // truncate for device display
    marketOutcome: outcome,
    marketAmount: formattedAmount,
    marketShares: formattedShares,
    marketPrice: formattedPrice,
    makerAmount,
    takerAmount,
    side,
  };
}

/**
 * Fetch a signed MCP TLV payload from the backend attester service.
 * Accepts either a PolymarketMarketInfo (order) or AuthContextInfo (auth).
 */
export async function fetchSignedMCPPayload(
  info: PolymarketMarketInfo | AuthContextInfo
): Promise<Uint8Array> {
  const body = info.type === "auth"
    ? {
        type: "auth",
        chainId: info.chainId,
        label: info.label,
        address: info.address,
      }
    : {
        tokenId: (info as PolymarketMarketInfo).tokenId.toString(),
        chainId: info.chainId,
        marketName: (info as PolymarketMarketInfo).marketName,
        marketOutcome: (info as PolymarketMarketInfo).marketOutcome,
        marketAmount: (info as PolymarketMarketInfo).marketAmount,
        marketShares: (info as PolymarketMarketInfo).marketShares,
        marketPrice: (info as PolymarketMarketInfo).marketPrice,
        marketSide: (info as PolymarketMarketInfo).side === 0 ? "Buy" : "Sell",
      };

  const res = await fetch(`${API_BASE}/api/market-context/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`MCP signing failed: ${res.status}`);
  }
  const { payload } = await res.json();
  return Uint8Array.from(
    payload.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16))
  );
}
