// Use same-origin API in production; allow override in development only.
const API_BASE = import.meta.env.DEV ? import.meta.env.VITE_BACKEND_URL || "" : "";

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
  // Polymarket CLOB API accepts decimal tokenId strings
  const tokenIdStr = tokenId.toString();
  const url = `${POLYMARKET_CLOB_API}/markets?clob_token_ids=${tokenIdStr}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Polymarket API error: ${res.status}`);
  }
  const data = await res.json();
  const markets: Array<{
    question: string;
    tokens: Array<{ token_id: string; outcome: string }>;
  }> = data?.data ?? data;

  if (!markets || markets.length === 0) {
    throw new Error(`No market found for tokenId ${tokenIdStr}`);
  }
  const market = markets[0]!;
  // Match by decimal string (Polymarket returns token_id as decimal)
  const token = market.tokens.find(
    (t) => t.token_id === tokenIdStr
  );
  const outcome = token?.outcome ?? "UNKNOWN";
  return { question: market.question, outcome };
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

  // TODO: fetch real market metadata from Polymarket CLOB API
  const question = "Will ETH hit $5k by end of 2025?";
  const outcome = "Yes";

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
