import { useState, useCallback } from "react";

// =============================================================================
// Types
// =============================================================================

interface MarketOutcome {
  name: string;
  price: number;
  tokenId: string;
}

interface MarketOpportunity {
  conditionId: string;
  question: string;
  outcomes: MarketOutcome[];
  volume24h: number;
  liquidity: number;
  endDate: string;
  active: boolean;
  signal: "mispricing" | "momentum" | "volume_spike" | "interesting";
  signalStrength: number;
  memo: string;
}

interface DeliberationMessage {
  agent: string;
  agentLabel: string;
  message: string;
  round: number;
  timestamp: string;
}

interface ProposedTrade {
  outcome: "Yes" | "No";
  amount: string;
  reasoning: string;
}

interface CouncilDeliberation {
  id: string;
  market: MarketOpportunity;
  rounds: DeliberationMessage[];
  votes: Record<string, string>;
  verdict: "approved" | "rejected" | "no_consensus";
  proposedTrade?: ProposedTrade;
  createdIntentId?: string;
  timestamp: string;
}

// =============================================================================
// API Helpers
// =============================================================================

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3005";

async function fetchMarkets(): Promise<MarketOpportunity[]> {
  const res = await fetch(`${API_BASE}/api/polymarket/scan-cache`);
  if (!res.ok) {
    // Fallback to live scan
    const res2 = await fetch(`${API_BASE}/api/polymarket/opportunities?limit=10`);
    const data = await res2.json();
    return data.markets || [];
  }
  const data = await res.json();
  // If cache is empty, try live
  if (!data.markets?.length) {
    const res2 = await fetch(`${API_BASE}/api/polymarket/opportunities?limit=10`);
    const data2 = await res2.json();
    return data2.markets || [];
  }
  return data.markets;
}

async function startDeliberation(
  conditionId: string,
  outcome?: string,
  reason?: string,
): Promise<CouncilDeliberation> {
  const res = await fetch(`${API_BASE}/api/polymarket/council/deliberate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conditionId, outcome, reason }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Deliberation failed");
  return data.deliberation;
}

// =============================================================================
// Signal Badge
// =============================================================================

function SignalBadge({ signal, strength }: { signal: string; strength: number }) {
  const config: Record<string, { emoji: string; color: string; bg: string }> = {
    mispricing: { emoji: "⚠️", color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
    volume_spike: { emoji: "📈", color: "#34d399", bg: "rgba(52,211,153,0.1)" },
    momentum: { emoji: "🚀", color: "#60a5fa", bg: "rgba(96,165,250,0.1)" },
    interesting: { emoji: "💡", color: "#a78bfa", bg: "rgba(167,139,250,0.1)" },
  };
  const c = config[signal] ?? config.interesting!;

  return (
    <span
      className="inline-flex items-center gap-4 px-8 py-2 rounded-full text-[11px] font-medium"
      style={{ background: c.bg, color: c.color }}
    >
      {c.emoji} {signal.replace("_", " ")} ({strength})
    </span>
  );
}

// =============================================================================
// Market Card
// =============================================================================

function MarketCard({
  market,
  onAnalyze,
  analyzing,
}: {
  market: MarketOpportunity;
  onAnalyze: (m: MarketOpportunity) => void;
  analyzing: boolean;
}) {
  const endDate = new Date(market.endDate);
  const daysLeft = Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / 86_400_000));

  return (
    <div
      className="rounded-xl p-16 flex flex-col gap-10"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-12">
        <h3 className="text-[14px] font-semibold text-white/90 leading-snug flex-1">
          {market.question}
        </h3>
        <SignalBadge signal={market.signal} strength={market.signalStrength} />
      </div>

      {/* Outcomes */}
      <div className="flex gap-8">
        {market.outcomes.map((o) => (
          <div
            key={o.name}
            className="flex-1 rounded-lg px-12 py-8 flex flex-col items-center"
            style={{
              background:
                o.price > 0.5
                  ? "rgba(52,211,153,0.08)"
                  : "rgba(248,113,113,0.08)",
            }}
          >
            <span className="text-[11px] text-white/40">{o.name}</span>
            <span
              className="text-[18px] font-bold"
              style={{
                color: o.price > 0.5 ? "#34d399" : "#f87171",
              }}
            >
              {(o.price * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-16 text-[11px] text-white/30">
        <span>Vol: ${market.volume24h.toLocaleString()}</span>
        <span>Liq: ${market.liquidity.toLocaleString()}</span>
        <span>{daysLeft}d left</span>
      </div>

      {/* Memo */}
      <p className="text-[11px] text-white/40 leading-relaxed">{market.memo}</p>

      {/* Analyze Button */}
      <button
        type="button"
        onClick={() => onAnalyze(market)}
        disabled={analyzing}
        className="mt-4 w-full py-10 rounded-lg text-[13px] font-semibold transition-all duration-200"
        style={{
          background: analyzing
            ? "rgba(255,255,255,0.05)"
            : "linear-gradient(135deg, #7c3aed, #4f46e5)",
          color: analyzing ? "rgba(255,255,255,0.3)" : "#fff",
          cursor: analyzing ? "not-allowed" : "pointer",
        }}
      >
        {analyzing ? (
          <span className="flex items-center justify-center gap-8">
            <span className="size-[14px] border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            Council is deliberating…
          </span>
        ) : (
          "🧑‍⚖️ Ask the Council"
        )}
      </button>
    </div>
  );
}

// =============================================================================
// Deliberation Result
// =============================================================================

function DeliberationResult({ result }: { result: CouncilDeliberation }) {
  const verdictColor =
    result.verdict === "approved"
      ? "#34d399"
      : result.verdict === "rejected"
        ? "#f87171"
        : "#fbbf24";

  return (
    <div
      className="rounded-xl p-16 flex flex-col gap-12"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${verdictColor}33`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-white/90">
          {result.market.question}
        </h3>
        <span
          className="text-[12px] font-bold px-10 py-4 rounded-full"
          style={{ background: `${verdictColor}20`, color: verdictColor }}
        >
          {result.verdict === "approved"
            ? "✅ APPROVED"
            : result.verdict === "rejected"
              ? "❌ REJECTED"
              : "⚖️ NO CONSENSUS"}
        </span>
      </div>

      {/* Proposed trade if approved */}
      {result.proposedTrade && (
        <div
          className="rounded-lg p-12 flex items-center gap-16"
          style={{ background: "rgba(52,211,153,0.08)" }}
        >
          <span className="text-[24px]">💰</span>
          <div>
            <p className="text-[14px] font-bold text-white/90">
              {result.proposedTrade.outcome} — {result.proposedTrade.amount} USDC
            </p>
            <p className="text-[11px] text-white/40 mt-2">
              {result.proposedTrade.reasoning?.slice(0, 150)}
            </p>
          </div>
        </div>
      )}

      {result.createdIntentId && (
        <div
          className="rounded-lg px-12 py-8 text-[11px] font-mono"
          style={{ background: "rgba(52,211,153,0.06)", color: "#34d399" }}
        >
          ✅ Intent created: {result.createdIntentId}
        </div>
      )}

      {/* Votes */}
      <div className="flex gap-8">
        {Object.entries(result.votes).map(([agent, vote]) => {
          const voteColor =
            vote === "approve" ? "#34d399" : vote === "reject" ? "#f87171" : "#666";
          return (
            <div
              key={agent}
              className="flex-1 rounded-lg px-10 py-6 text-center"
              style={{ background: `${voteColor}10` }}
            >
              <span className="text-[10px] text-white/30 block">{agent}</span>
              <span
                className="text-[12px] font-bold"
                style={{ color: voteColor }}
              >
                {(vote as string).toUpperCase()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Discussion rounds */}
      <details className="mt-4">
        <summary className="text-[11px] text-white/30 cursor-pointer hover:text-white/50 transition-colors">
          Show full discussion ({result.rounds.length} messages)
        </summary>
        <div className="mt-8 flex flex-col gap-8">
          {result.rounds.map((r, i) => (
            <div
              key={`${r.agent}-${r.round}-${i}`}
              className="pl-12 border-l-2 py-4"
              style={{
                borderColor:
                  r.agent === "analyst"
                    ? "#6ee7b7"
                    : r.agent === "riskManager"
                      ? "#7dd3fc"
                      : "#fbbf24",
              }}
            >
              <div className="flex items-baseline gap-6 mb-2">
                <span className="text-[11px] font-semibold text-white/60">
                  {r.agentLabel}
                </span>
                <span className="text-[9px] text-white/20">Round {r.round}</span>
              </div>
              <p className="text-[11px] text-white/40 whitespace-pre-wrap leading-relaxed">
                {r.message}
              </p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function PolymarketCouncil() {
  const [markets, setMarkets] = useState<MarketOpportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [deliberations, setDeliberations] = useState<CouncilDeliberation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleFindMarkets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await fetchMarkets();
      setMarkets(m);
      if (m.length === 0) {
        setError("No active markets found. Scanner may still be initializing.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch markets");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAnalyze = useCallback(async (market: MarketOpportunity) => {
    setAnalyzingId(market.conditionId);
    setError(null);
    try {
      const result = await startDeliberation(market.conditionId);
      setDeliberations((prev) => [result, ...prev]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Deliberation failed — check GEMINI_API_KEY in backend env",
      );
    } finally {
      setAnalyzingId(null);
    }
  }, []);

  return (
    <div className="flex flex-col gap-20">
      {/* Header + Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[18px] font-bold text-white/90">
            🔮 Polymarket Council
          </h2>
          <p className="text-[12px] text-white/40 mt-2">
            Scan prediction markets and let the AI council analyze opportunities
          </p>
        </div>
        <button
          type="button"
          onClick={handleFindMarkets}
          disabled={loading}
          className="px-20 py-12 rounded-xl text-[14px] font-bold transition-all duration-300"
          style={{
            background: loading
              ? "rgba(255,255,255,0.05)"
              : "linear-gradient(135deg, #7c3aed, #2563eb)",
            color: "#fff",
            cursor: loading ? "not-allowed" : "pointer",
            boxShadow: loading ? "none" : "0 0 20px rgba(124,58,237,0.3)",
          }}
        >
          {loading ? (
            <span className="flex items-center gap-8">
              <span className="size-[16px] border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
              Scanning…
            </span>
          ) : (
            "🔍 Find Good Markets"
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-lg px-16 py-10 text-[12px]"
          style={{ background: "rgba(248,113,113,0.1)", color: "#f87171" }}
        >
          {error}
        </div>
      )}

      {/* Deliberation results */}
      {deliberations.length > 0 && (
        <div className="flex flex-col gap-12">
          <h3 className="text-[13px] font-semibold text-white/60 uppercase tracking-wider">
            Council Decisions
          </h3>
          {deliberations.map((d) => (
            <DeliberationResult key={d.id} result={d} />
          ))}
        </div>
      )}

      {/* Market cards */}
      {markets.length > 0 && (
        <div className="flex flex-col gap-12">
          <h3 className="text-[13px] font-semibold text-white/60 uppercase tracking-wider">
            Active Markets ({markets.length})
          </h3>
          <div className="grid gap-12">
            {markets.map((m) => (
              <MarketCard
                key={m.conditionId}
                market={m}
                onAnalyze={handleAnalyze}
                analyzing={analyzingId === m.conditionId}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && markets.length === 0 && deliberations.length === 0 && !error && (
        <div
          className="rounded-xl p-32 flex flex-col items-center gap-12"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          <span className="text-[32px]">🔮</span>
          <p className="text-[14px] text-white/40 text-center">
            Click <strong>"Find Good Markets"</strong> to scan Polymarket for
            trading opportunities
          </p>
          <p className="text-[11px] text-white/20 text-center">
            The scanner detects mispricing, volume spikes, and momentum signals. <br />
            Then ask the AI Council (Analyst, Risk Manager, Contrarian) to deliberate.
          </p>
        </div>
      )}
    </div>
  );
}
