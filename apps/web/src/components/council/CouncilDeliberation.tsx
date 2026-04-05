import { useEffect, useRef } from "react";
import { useCouncilDeliberation } from "@/hooks/useCouncilDeliberation";
import type { AgentState, AgentVote, CouncilCompletePayload, CouncilState } from "@/lib/councilTypes";
import { councilStateToArchivedRecord } from "@/lib/councilTypes";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@ledgerhq/lumen-ui-react";

// =============================================================================
// Types
// =============================================================================

interface CouncilDeliberationProps {
  intentId: string;
  onComplete: (payload: CouncilCompletePayload) => void;
}

// =============================================================================
// Minimal agent accent — just a thin left-bar color
// =============================================================================

const AGENT_STYLE: Record<string, { bar: string; name: string }> = {
  bull: { bar: "#6ee7b7", name: "#6ee7b7" },   // green
  bear: { bar: "#fbbf24", name: "#fbbf24" },   // amber
  quant: { bar: "#7dd3fc", name: "#7dd3fc" },  // sky
};

function agentStyle(id: string) {
  return AGENT_STYLE[id] ?? { bar: "#a78bfa", name: "#a78bfa" };
}

// =============================================================================
// Vote tag — tiny, monochrome
// =============================================================================

function VoteTag({ vote }: { vote: AgentVote }) {
  if (vote === "FOR") {
    return (
      <span className="text-[10px] font-mono tracking-wider" style={{ color: "#6ee7b7" }}>
        FOR
      </span>
    );
  }
  if (vote === "AGAINST") {
    return (
      <span className="text-[10px] font-mono tracking-wider" style={{ color: "#fca5a5" }}>
        AGAINST
      </span>
    );
  }
  return (
    <span className="text-[10px] font-mono tracking-wider" style={{ color: "#555" }}>
      ABSTAIN
    </span>
  );
}

// =============================================================================
// Single agent message block — iMessage style
// Bull Analyst & Risk Manager → left (gray bubble)
// Contrarian → right (blue bubble)
// =============================================================================

const RIGHT_AGENTS = new Set(["quant"]);

function MessageBlock({
  agent,
  content,
  isStreaming,
}: {
  agent: AgentState;
  content: string;
  isStreaming?: boolean;
}) {
  const text = content.replace(/\n*VOTE:\s*(FOR|AGAINST)\b.*/i, "").trim();
  const voteMatch = content.match(/VOTE:\s*(FOR|AGAINST)\b/i);
  const vote = voteMatch?.[1] ? (voteMatch[1].toUpperCase() as AgentVote) : null;

  const isRight = RIGHT_AGENTS.has(agent.id);

  return (
    <div className={`flex flex-col ${isRight ? "items-end" : "items-start"} max-w-[85%] ${isRight ? "self-end" : "self-start"}`}>
      {/* Name + vote */}
      <div className={`flex items-baseline gap-6 mb-3 ${isRight ? "flex-row-reverse" : ""}`}>
        <span className="text-[11px] font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>
          {agent.avatar} {agent.name}
        </span>
        {vote && !isStreaming && <VoteTag vote={vote} />}
      </div>

      {/* Bubble */}
      {(text || isStreaming) ? (
        <div
          className="px-14 py-10"
          style={{
            background: isRight ? "#0b84fe" : "#2c2c2e",
            borderRadius: isRight ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
          }}
        >
          <p className="text-[13px] leading-[1.65] whitespace-pre-wrap" style={{ color: "#fff" }}>
            {text}
            {isStreaming && (
              <span
                className="inline-block w-px h-[0.85em] ml-[2px] align-text-bottom animate-pulse"
                style={{ background: "rgba(255,255,255,0.6)" }}
              />
            )}
          </p>
        </div>
      ) : (
        <div
          className="px-14 py-10"
          style={{
            background: isRight ? "#0b84fe" : "#2c2c2e",
            borderRadius: isRight ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
          }}
        >
          <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>…</span>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Build ordered message list
// =============================================================================

function buildMessages(state: CouncilState) {
  const out: Array<{
    key: string;
    agent: AgentState;
    round: number;
    content: string;
    streaming: boolean;
  }> = [];

  const maxRound = Math.max(
    state.currentRound ?? 1,
    ...state.agents.flatMap((a) => a.messages.map((m) => m.round)),
    1,
  );

  for (let r = 1; r <= maxRound; r++) {
    for (const agent of state.agents) {
      const msg = agent.messages.find((m) => m.round === r);
      if (msg) {
        out.push({ key: `${agent.id}-${r}`, agent, round: r, content: msg.content, streaming: false });
      } else if (agent.status === "thinking" && (state.currentRound ?? 1) === r) {
        out.push({ key: `${agent.id}-${r}-s`, agent, round: r, content: agent.currentStreamContent, streaming: true });
      }
    }
  }
  return out;
}

// =============================================================================
// Summary bar — pinned at the bottom of the chat panel
// =============================================================================

function SummaryBar({ state }: { state: CouncilState }) {
  const isDone = state.phase === "complete" || state.phase === "cached";
  const isActive = state.phase === "deliberating" || state.phase === "voting" || state.phase === "connecting";

  if (state.phase === "idle" || state.phase === "error") return null;

  return (
    <div className="flex-shrink-0 flex items-center justify-center px-12 py-12" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
      <div
        className="w-[96%] h-[60px] rounded-xl flex items-center justify-center px-20 gap-10"
        style={{ background: "#ffffff" }}
      >
        {isActive && !isDone && (
          <div className="flex items-center gap-10">
            <div className="flex items-center gap-[5px]">
              <span className="size-[6px] rounded-full bg-black/30 animate-bounce" style={{ animationDelay: "0ms", animationDuration: "900ms" }} />
              <span className="size-[6px] rounded-full bg-black/30 animate-bounce" style={{ animationDelay: "150ms", animationDuration: "900ms" }} />
              <span className="size-[6px] rounded-full bg-black/30 animate-bounce" style={{ animationDelay: "300ms", animationDuration: "900ms" }} />
            </div>
            <span className="text-[14px] font-medium text-black/40">
              Deliberation in progress…
            </span>
          </div>
        )}
        {isDone && (
          <span className="text-[14px] font-medium text-black text-center leading-snug">
            {state.result?.summary ?? (state.result?.approved ? "Trade approved by council." : "Trade rejected by council.")}
          </span>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Verdict
// =============================================================================

function Verdict({ result }: {
  result: { approved: boolean; ratio: number; totalFor: number; totalAgainst: number; totalAbstain: number };
}) {
  const total = result.totalFor + result.totalAgainst + result.totalAbstain;
  return (
    <div
      className="flex items-baseline gap-8 pt-12 mt-4 border-t"
      style={{ borderColor: "rgba(255,255,255,0.06)" }}
    >
      <span
        className="text-[12px] font-medium"
        style={{ color: result.approved ? "#6ee7b7" : "#fca5a5" }}
      >
        {result.approved ? "Approved" : "Rejected"}
      </span>
      <span className="text-[11px]" style={{ color: "#444" }}>
        {result.totalFor}/{total} for · {Math.round(result.ratio * 100)}%
      </span>
    </div>
  );
}

// =============================================================================
// Main feed
// =============================================================================

function Feed({ state, onRetry }: { state: CouncilState; onRetry: () => void }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollKey =
    state.phase +
    state.currentRound +
    state.agents.map((a) => a.messages.length + a.currentStreamContent.length).join(",");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [scrollKey]);

  if (state.phase === "idle" || state.phase === "connecting") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-10">
        <Spinner size="sm" />
        <span className="text-[11px] text-white/20">Connecting…</span>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-10">
        <span className="text-[12px] text-white/40">{state.error ?? "Connection error"}</span>
        <Button size="sm" onClick={onRetry}>Retry</Button>
      </div>
    );
  }

  const msgs = buildMessages(state);
  const rounds = [...new Set(msgs.map((m) => m.round))].sort((a, b) => a - b);
  const isLive = state.phase === "deliberating" || state.phase === "voting";
  const isDone = state.phase === "complete" || state.phase === "cached";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Scrollable chat area */}
      <div
        className="flex-1 overflow-y-auto flex flex-col gap-0 px-20 py-16 min-h-0"
        style={{ scrollbarWidth: "none" }}
      >
        {/* Topline */}
        <div className="flex items-center gap-8 mb-16">
          <span className="text-[10px] text-white/20 uppercase tracking-[0.15em]">
            Council
          </span>
          {isLive && (
            <>
              <span className="size-[4px] rounded-full bg-white/30 animate-pulse" />
              <span className="text-[10px] text-white/30">live</span>
            </>
          )}
        </div>

        {/* Rounds */}
        {rounds.map((round, ri) => (
          <div key={round} className="flex flex-col gap-14">
            {ri > 0 && (
              <div
                className="h-px my-10"
                style={{ background: "rgba(255,255,255,0.04)" }}
              />
            )}
            <span className="text-[9px] text-white/15 uppercase tracking-[0.2em] mb-2">
              Round {round}
            </span>
            {msgs
              .filter((m) => m.round === round)
              .map((m) => (
                <MessageBlock
                  key={m.key}
                  agent={m.agent}
                  content={m.content}
                  isStreaming={m.streaming}
                />
              ))}
          </div>
        ))}

        {/* Verdict */}
        {state.result && isDone && <Verdict result={state.result} />}

        <div ref={bottomRef} />
      </div>

      {/* ── Bottom summary bar ── */}
      <SummaryBar state={state} />
    </div>
  );
}

// =============================================================================
// Export
// =============================================================================

export function CouncilDeliberation({ intentId, onComplete }: CouncilDeliberationProps) {
  const { state, start } = useCouncilDeliberation(intentId);
  const startedRef = useRef(false);
  const completedRef = useRef(false);

  useEffect(() => {
    startedRef.current = false;
    completedRef.current = false;
  }, [intentId]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    start();
  }, [intentId, start]);

  useEffect(() => {
    if (completedRef.current) return;
    if (state.result && (state.phase === "complete" || state.phase === "cached")) {
      const record = councilStateToArchivedRecord(state);
      if (!record) return;
      completedRef.current = true;
      onComplete({
        approved: state.result.approved,
        ratio: state.result.ratio,
        record,
      });
    }
  }, [state.phase, state.result, onComplete]);

  return <Feed state={state} onRetry={start} />;
}
