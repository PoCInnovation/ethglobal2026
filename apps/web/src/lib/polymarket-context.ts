// Polymarket CLOB API endpoint
const POLYMARKET_CLOB_API = "https://clob.polymarket.com";

// EIP-712 primaryType for Polymarket orders
const POLYMARKET_PRIMARY_TYPE = "Order";

export interface PolymarketMarketInfo {
  tokenId: bigint;
  chainId: number;
  marketName: string;
  marketOutcome: string; // "YES" or "NO"
  marketAmount: string; // e.g., "50.00 USDC"
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
  return primaryType === POLYMARKET_PRIMARY_TYPE && domain.chainId === 137;
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
  const tokenIdHex = tokenId.toString(16).padStart(64, "0");
  const url = `${POLYMARKET_CLOB_API}/markets?clob_token_ids=${tokenIdHex}`;
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
    throw new Error(`No market found for tokenId ${tokenIdHex}`);
  }
  const market = markets[0]!;
  const tokenHex = tokenId.toString(16).padStart(64, "0");
  const token = market.tokens.find(
    (t) => t.token_id.toLowerCase() === tokenHex.toLowerCase()
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

  const { question, outcome } = await fetchMarketMetadata(tokenId);

  // Format USDC amount (6 decimals)
  const usdcAmount = side === 0 ? makerAmount : takerAmount;
  const formattedAmount = `${(Number(usdcAmount) / 1_000_000).toFixed(2)} USDC`;

  return {
    tokenId,
    chainId,
    marketName: question.slice(0, 100), // truncate for device display
    marketOutcome: outcome,
    marketAmount: formattedAmount,
    makerAmount,
    takerAmount,
    side,
  };
}

/**
 * Fetch a signed MCP TLV payload from the backend attester service.
 */
export async function fetchSignedMCPPayload(
  info: PolymarketMarketInfo
): Promise<Uint8Array> {
  const res = await fetch("/api/market-context/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenId: info.tokenId.toString(),
      chainId: info.chainId,
      marketName: info.marketName,
      marketOutcome: info.marketOutcome,
      marketAmount: info.marketAmount,
    }),
  });
  if (!res.ok) {
    throw new Error(`MCP signing failed: ${res.status}`);
  }
  const { payload } = await res.json();
  return Uint8Array.from(
    payload.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16))
  );
}
