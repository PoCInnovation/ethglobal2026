/**
 * Council Orchestrator — deliberation engine that manages rounds, streaming, and voting.
 * Uses Google Gemini API for all agent inference.
 */
import { GoogleGenAI } from "@google/genai";
import {
  COUNCIL_AGENTS,
  COUNCIL_DISCUSSION_ROUNDS,
  COUNCIL_MODEL,
  COUNCIL_MAX_TOKENS,
  COUNCIL_VOTE_MAX_TOKENS,
  COUNCIL_APPROVAL_THRESHOLD,
} from "./councilConfig.js";
import type {
  CouncilEvent,
  CouncilResult,
  AgentVote,
  AgentDeliberationResult,
} from "./councilTypes.js";

// ---------- Types ----------

interface MarketContext {
  marketTitle: string;
  conditionId: string;
  outcome: "Yes" | "No";
  amount: string;
  outcomePrice?: number;
}

type EventEmitter = (event: CouncilEvent) => void;

// ---------- Single Gemini client ----------

const geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

// ---------- Helpers ----------

function parseVoteFromText(text: string): AgentVote | null {
  const match = text.match(/\bVOTE:\s*(FOR|AGAINST)\b/i);
  if (!match) return null;
  return match[1].toUpperCase() as "FOR" | "AGAINST";
}

async function extractVoteFallback(
  lastMessage: string,
  signal: AbortSignal,
): Promise<AgentVote> {
  try {
    const response = await geminiClient.models.generateContent({
      model: COUNCIL_MODEL,
      contents: `You just provided this analysis: ${lastMessage}\n\nCast your vote. Respond with ONLY one word: FOR or AGAINST`,
      config: { maxOutputTokens: COUNCIL_VOTE_MAX_TOKENS },
    });

    if (signal.aborted) return "ABSTAIN";

    const text = response.text ?? "";
    const vote = parseVoteFromText(`VOTE: ${text.trim()}`);
    return vote ?? "ABSTAIN";
  } catch {
    return "ABSTAIN";
  }
}

// ---------- Main orchestrator ----------

export async function runCouncilDeliberation(
  market: MarketContext,
  emit: EventEmitter,
  signal: AbortSignal,
): Promise<CouncilResult> {
  const conversationHistory: Record<string, string[]> = {};
  const agentResults: AgentDeliberationResult[] = [];
  let totalAgentFailures = 0;

  console.log(`[council] Starting deliberation — market: "${market.marketTitle}" outcome=${market.outcome} amount=${market.amount} price=${market.outcomePrice ?? "?"}`);
  console.log(`[council] Key loaded: ${(process.env.GEMINI_API_KEY ?? "").slice(0, 8)}…`);
  console.log(`[council] Model: ${COUNCIL_MODEL} rounds: ${COUNCIL_DISCUSSION_ROUNDS}`);

  for (const agent of COUNCIL_AGENTS) {
    conversationHistory[agent.id] = [];
    agentResults.push({
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      avatar: agent.avatar,
      rounds: [],
      vote: "ABSTAIN",
    });
  }

  // 1. Emit council_started
  emit({
    type: "council_started",
    payload: {
      agents: COUNCIL_AGENTS.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        avatar: a.avatar,
      })),
    },
  });
  console.log(`[council] council_started emitted (${COUNCIL_AGENTS.length} agents)`);

  // 2. Deliberation rounds
  for (let round = 1; round <= COUNCIL_DISCUSSION_ROUNDS; round++) {
    console.log(`[council] ── Round ${round}/${COUNCIL_DISCUSSION_ROUNDS} ──`);
    for (let agentIndex = 0; agentIndex < COUNCIL_AGENTS.length; agentIndex++) {
      const agent = COUNCIL_AGENTS[agentIndex]!;
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");

      const agentResult = agentResults.find((r) => r.agentId === agent.id)!;

      emit({ type: "agent_thinking", payload: { agentId: agent.id, round } });
      console.log(`[council] ${agent.avatar} ${agent.name} — calling Gemini...`);

      const systemInstruction =
        agent.systemPrompt + (agent.memory ? `\n\nMEMORY:\n${agent.memory}` : "");

      let userContent: string;
      if (round === 1) {
        const impliedProb = market.outcomePrice ? `${(market.outcomePrice * 100).toFixed(1)}%` : "unknown";
        const payout = market.outcomePrice ? `${(1 / market.outcomePrice).toFixed(2)}x` : "unknown";
        userContent = [
          `TRADE TO ANALYZE:`,
          `Market: "${market.marketTitle}"`,
          `Outcome to buy: ${market.outcome}`,
          `Current market price: ${market.outcomePrice ?? "unknown"} (implied probability: ${impliedProb})`,
          `Potential payout if correct: ${payout} per dollar`,
          `Position size: ${market.amount} USDC`,
          ``,
          `Give your analysis of this specific trade. Be concrete — reference the market title, the price, and the implied probability in your reasoning. This is round ${round} of ${COUNCIL_DISCUSSION_ROUNDS}.`,
        ].join("\n");
      } else {
        const otherMessages = COUNCIL_AGENTS.filter((a) => a.id !== agent.id)
          .map((a) => {
            const msg = conversationHistory[a.id][round - 2];
            return msg ? `${a.name} (${a.role}):\n${msg}` : null;
          })
          .filter(Boolean)
          .join("\n\n---\n\n");

        userContent = [
          `Here are your colleagues' analyses:`,
          ``,
          otherMessages,
          ``,
          `This is round ${round} of ${COUNCIL_DISCUSSION_ROUNDS} — your FINAL round. React to their arguments, then CAST YOUR VOTE.`,
          `You MUST end your message with either "VOTE: FOR" or "VOTE: AGAINST" on its own line.`,
        ].join("\n");
      }

      try {
        const streamStart = Date.now();
        const stream = await geminiClient.models.generateContentStream({
          model: COUNCIL_MODEL,
          contents: userContent,
          config: {
            systemInstruction,
            maxOutputTokens: COUNCIL_MAX_TOKENS,
          },
        });
        console.log(`[council] ${agent.name} — stream opened (${Date.now() - streamStart}ms), reading tokens...`);

        let fullContent = "";
        let tokenCount = 0;
        let finishReason = "";

        for await (const chunk of stream) {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          const token = chunk.text ?? "";
          if (token) {
            fullContent += token;
            tokenCount++;
            emit({ type: "agent_token", payload: { agentId: agent.id, token, round } });
          }
          const candidate = chunk.candidates?.[0];
          if (candidate?.finishReason) finishReason = candidate.finishReason;
        }

        console.log(`[council] ${agent.name} — finishReason: ${finishReason || "(none)"}`);
        emit({
          type: "agent_message",
          payload: { agentId: agent.id, content: fullContent, round },
        });

        conversationHistory[agent.id].push(fullContent);
        agentResult.rounds.push(fullContent);

        console.log(`[council] ${agent.name} — done: ${tokenCount} tokens, ${fullContent.length} chars, ${Date.now() - streamStart}ms total`);
        const voteInText = parseVoteFromText(fullContent);
        console.log(`[council] ${agent.name} — VOTE in text: ${voteInText ?? "(none, will use fallback)"}`);
      } catch (err) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        totalAgentFailures++;
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`[council] ${agent.name} — ERROR (failure ${totalAgentFailures}/${COUNCIL_AGENTS.length}):`, errorMessage);

        emit({ type: "error", payload: { agentId: agent.id, message: errorMessage } });

        agentResult.error = errorMessage;
        agentResult.vote = "ABSTAIN";
        conversationHistory[agent.id].push("");
        agentResult.rounds.push("");

        if (totalAgentFailures >= COUNCIL_AGENTS.length) {
          emit({ type: "error", payload: { fatal: true, message: "All agents failed during deliberation" } });
          throw new Error("All agents failed during deliberation");
        }
      }
    }
    console.log(`[council] Round ${round} complete`);
  }

  // 3. Voting phase
  for (let agentIndex = 0; agentIndex < COUNCIL_AGENTS.length; agentIndex++) {
    const agent = COUNCIL_AGENTS[agentIndex]!;
    const agentResult = agentResults.find((r) => r.agentId === agent.id)!;

    if (agentResult.error) {
      emit({ type: "agent_vote", payload: { agentId: agent.id, vote: "ABSTAIN" } });
      continue;
    }

    const lastMessage = conversationHistory[agent.id][conversationHistory[agent.id].length - 1] ?? "";
    let vote = parseVoteFromText(lastMessage);

    if (!vote) {
      console.log(`[council/orchestrator] ${agent.name} — no VOTE found in text, running fallback`);
      vote = await extractVoteFallback(lastMessage, signal);
    }

    agentResult.vote = vote;
    console.log(`[council/orchestrator] ${agent.name} voted: ${vote}`);
    emit({ type: "agent_vote", payload: { agentId: agent.id, vote: agentResult.vote } });
  }

  // 4. Calculate result
  const totalFor = agentResults.filter((a) => a.vote === "FOR").length;
  const totalAgainst = agentResults.filter((a) => a.vote === "AGAINST").length;
  const totalAbstain = agentResults.filter((a) => a.vote === "ABSTAIN").length;
  const votingAgents = totalFor + totalAgainst;
  const ratio = votingAgents > 0 ? totalFor / votingAgents : 0;
  const approved = ratio > COUNCIL_APPROVAL_THRESHOLD;

  console.log(`[council/orchestrator] Result: approved=${approved} FOR=${totalFor} AGAINST=${totalAgainst} ABSTAIN=${totalAbstain}`);

  const votes: Record<string, AgentVote> = {};
  for (const a of agentResults) votes[a.agentId] = a.vote;

  const result: CouncilResult = {
    approved,
    votes,
    ratio,
    totalFor,
    totalAgainst,
    totalAbstain,
    agents: agentResults,
    deliberatedAt: new Date().toISOString(),
  };

  emit({ type: "council_result", payload: result as unknown as Record<string, unknown> });

  return result;
}
