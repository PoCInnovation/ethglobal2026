export type AgentVote = "FOR" | "AGAINST" | "ABSTAIN";

export type CouncilPhase =
  | "idle"
  | "connecting"
  | "deliberating"
  | "voting"
  | "complete"
  | "error"
  | "cached";

export interface AgentState {
  id: string;
  name: string;
  role: string;
  avatar: string;
  status: "waiting" | "thinking" | "done" | "error";
  messages: { round: number; content: string }[];
  currentStreamContent: string; // tokens being streamed
  vote?: AgentVote;
}

export interface CouncilState {
  phase: CouncilPhase;
  agents: AgentState[];
  currentRound: number;
  result?: {
    approved: boolean;
    ratio: number;
    totalFor: number;
    totalAgainst: number;
    totalAbstain: number;
    summary?: string;
  };
  error?: string;
}

/** Same shape as server `intent.details.councilResult` — for archive UI after SSE completes. */
export interface CouncilArchivedRecord {
  approved: boolean;
  ratio: number;
  totalFor: number;
  totalAgainst: number;
  totalAbstain: number;
  summary?: string;
  agents: Array<{
    agentId: string;
    agentName: string;
    role: string;
    avatar: string;
    rounds: string[];
    vote: string;
  }>;
}

export interface CouncilCompletePayload {
  approved: boolean;
  ratio: number;
  record: CouncilArchivedRecord;
}

export function councilStateToArchivedRecord(state: CouncilState): CouncilArchivedRecord | null {
  if (!state.result) return null;
  const agents = state.agents.map((a) => ({
    agentId: a.id,
    agentName: a.name,
    role: a.role,
    avatar: a.avatar,
    rounds: [...a.messages].sort((x, y) => x.round - y.round).map((m) => m.content),
    vote: a.vote ?? "ABSTAIN",
  }));
  return {
    approved: state.result.approved,
    ratio: state.result.ratio,
    totalFor: state.result.totalFor,
    totalAgainst: state.result.totalAgainst,
    totalAbstain: state.result.totalAbstain,
    summary: state.result.summary,
    agents,
  };
}
