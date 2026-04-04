/**
 * Backend-only types shared between the council orchestrator and SSE endpoint.
 */

// --- SSE Events emitted to client ---

export type CouncilEventType =
  | "council_started"  // Deliberation started, agent list
  | "agent_thinking"   // An agent starts thinking
  | "agent_token"      // Individual token (streaming)
  | "agent_message"    // Complete agent message (end of turn)
  | "agent_vote"       // Agent's vote
  | "council_result"   // Final vote result
  | "council_cached"   // Result from cache
  | "error";           // Error (agent or global)

export interface CouncilEvent {
  type: CouncilEventType;
  payload: Record<string, unknown>;
}

// --- Internal state types ---

export type AgentVote = "FOR" | "AGAINST" | "ABSTAIN";

export interface AgentDeliberationResult {
  agentId: string;
  agentName: string;
  role: string;
  avatar: string;
  rounds: string[];  // Messages per round
  vote: AgentVote;
  error?: string;    // If agent failed
}

export interface CouncilResult {
  approved: boolean;
  votes: Record<string, AgentVote>; // agentId → vote
  ratio: number;                     // e.g. 0.67
  totalFor: number;
  totalAgainst: number;
  totalAbstain: number;
  agents: AgentDeliberationResult[];
  deliberatedAt: string;             // ISO timestamp
  summary?: string;                  // One-line human-readable recap
}
