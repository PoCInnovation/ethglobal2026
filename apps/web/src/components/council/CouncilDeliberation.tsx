import { useEffect, useRef } from "react";
import { useCouncilDeliberation } from "@/hooks/useCouncilDeliberation";
import type { AgentState, AgentVote } from "@/lib/councilTypes";
import { Spinner } from "@/components/ui/Spinner";
import { Tag, Button } from "@ledgerhq/lumen-ui-react";

// =============================================================================
// Types
// =============================================================================

interface CouncilDeliberationProps {
  intentId: string;
  onComplete: (result: { approved: boolean; ratio: number }) => void;
}

// =============================================================================
// AgentCard (sub-component)
// =============================================================================

function AgentCard({ agent }: { agent: AgentState }) {
  // Group messages by round
  const rounds = agent.messages.reduce<Record<number, string[]>>((acc, msg) => {
    if (!acc[msg.round]) acc[msg.round] = [];
    acc[msg.round]!.push(msg.content);
    return acc;
  }, {});

  const roundNumbers = Object.keys(rounds)
    .map(Number)
    .sort((a, b) => a - b);

  const voteAppearance: Record<AgentVote, "success" | "error" | "gray"> = {
    FOR: "success",
    AGAINST: "error",
    ABSTAIN: "gray",
  };

  const voteLabel: Record<AgentVote, string> = {
    FOR: "FOR",
    AGAINST: "AGAINST",
    ABSTAIN: "ABSTAIN",
  };

  return (
    <div className="rounded-lg bg-muted-transparent p-16 flex flex-col gap-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="text-[1.25rem] leading-none">{agent.avatar}</span>
          <span className="body-2-semi-bold text-base">
            {agent.name}
          </span>
          <span className="body-3 text-muted">&mdash; {agent.role}</span>
        </div>
        {agent.vote && (
          <Tag
            appearance={voteAppearance[agent.vote]}
            size="sm"
            label={voteLabel[agent.vote]}
          />
        )}
      </div>

      {/* Messages by round */}
      {roundNumbers.map((round, idx) => (
        <div key={round} className="flex flex-col gap-8">
          {idx > 0 && (
            <div className="border-t border-dashed border-muted-subtle" />
          )}
          <span className="body-3 text-muted">Round {round}</span>
          {rounds[round]!.map((content, i) => (
            <p key={i} className="body-2 text-base whitespace-pre-wrap">
              {content}
            </p>
          ))}
        </div>
      ))}

      {/* Streaming content */}
      {agent.status === "thinking" && agent.currentStreamContent && (
        <div className="flex flex-col gap-8">
          {roundNumbers.length > 0 && (
            <div className="border-t border-dashed border-muted-subtle" />
          )}
          <p className="body-2 text-base whitespace-pre-wrap">
            {agent.currentStreamContent}
            <span className="inline-block w-[2px] h-[1em] bg-current ml-[2px] align-text-bottom animate-blink" />
          </p>
        </div>
      )}

      {/* Thinking (no stream content yet) */}
      {agent.status === "thinking" && !agent.currentStreamContent && (
        <div className="flex items-center gap-4">
          <span className="body-2 text-muted animate-pulse">
            &#9679; &#9679; &#9679;
          </span>
        </div>
      )}

      {/* Waiting */}
      {agent.status === "waiting" && (
        <span className="body-3 text-muted italic">(waiting...)</span>
      )}

      {/* Error */}
      {agent.status === "error" && (
        <span className="body-3 text-error">Agent encountered an error</span>
      )}
    </div>
  );
}

// =============================================================================
// ResultBanner
// =============================================================================

function ResultBanner({
  result,
}: {
  result: {
    approved: boolean;
    ratio: number;
    totalFor: number;
    totalAgainst: number;
    totalAbstain: number;
  };
}) {
  const total = result.totalFor + result.totalAgainst + result.totalAbstain;
  const pct = Math.round(result.ratio * 100);

  if (result.approved) {
    return (
      <div className="rounded-lg bg-success/10 p-16 text-center">
        <span className="body-1-semi-bold text-success">
          TRADE APPROVED &mdash; {result.totalFor}/{total} voted FOR ({pct}%)
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-error/10 p-16 text-center">
      <span className="body-1-semi-bold text-error">
        TRADE REJECTED &mdash; {result.totalFor}/{total} voted FOR ({pct}%)
      </span>
    </div>
  );
}

// =============================================================================
// CouncilDeliberation (main component)
// =============================================================================

export function CouncilDeliberation({
  intentId,
  onComplete,
}: CouncilDeliberationProps) {
  const { state, start } = useCouncilDeliberation(intentId);
  const startedRef = useRef(false);
  const completedRef = useRef(false);

  // Auto-start once — guard against React Strict Mode double-invoke
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    start();
  }, [start]);

  // Notify parent when result arrives — fire once only
  useEffect(() => {
    if (completedRef.current) return;
    if (state.result && (state.phase === "complete" || state.phase === "cached")) {
      completedRef.current = true;
      onComplete({
        approved: state.result.approved,
        ratio: state.result.ratio,
      });
    }
  }, [state.phase, state.result, onComplete]);

  // ---- idle / connecting ----
  if (state.phase === "idle" || state.phase === "connecting") {
    return (
      <div className="flex flex-col gap-16">
        <Header />
        <div className="flex items-center justify-center gap-8 py-32">
          <Spinner size="sm" />
          <span className="body-2 text-muted">Connecting to council...</span>
        </div>
      </div>
    );
  }

  // ---- error ----
  if (state.phase === "error") {
    return (
      <div className="flex flex-col gap-16">
        <Header />
        <div className="rounded-lg bg-error/10 p-16 flex flex-col items-center gap-12">
          <span className="body-2 text-error">
            {state.error || "An error occurred during deliberation."}
          </span>
          <Button size="sm" onClick={() => start()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // ---- deliberating / voting / complete / cached ----
  return (
    <div className="flex flex-col gap-16">
      <Header />

      <div className="flex flex-col gap-12">
        {state.agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>

      {state.result && (state.phase === "complete" || state.phase === "cached") && (
        <ResultBanner result={state.result} />
      )}
    </div>
  );
}

// =============================================================================
// Header
// =============================================================================

function Header() {
  return (
    <div className="flex flex-col gap-4">
      <span className="heading-3-semi-bold text-base">
        AI Council Deliberation
      </span>
      <span className="body-3 text-muted">
        &ldquo;Should we take this position?&rdquo;
      </span>
    </div>
  );
}
