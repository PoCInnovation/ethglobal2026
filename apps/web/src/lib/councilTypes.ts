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
