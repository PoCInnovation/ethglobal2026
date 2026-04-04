/**
 * Agent Council — Three AI agents deliberate on Polymarket trading opportunities.
 *
 * Agents:
 *   - Analyst     : Data-driven, probabilistic reasoning, value betting
 *   - Risk Manager: Position sizing, downside protection, capital allocation
 *   - Contrarian  : Devil's advocate, cognitive bias detection, edge-case finder
 *
 * Flow:
 *   1. Present opportunity
 *   2. Round 1: each agent gives initial opinion (Risk Manager proposes sizing)
 *   3. Round 2: cross-reactions
 *   4. Vote: APPROVE / REJECT / ABSTAIN — 2/3 majority required
 *   5. If approved → create polymarket_trade intent
 */

import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import type { MarketOpportunity } from "./polymarket-scanner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRole = "analyst" | "riskManager" | "contrarian";
export type VoteChoice = "approve" | "reject" | "abstain";
export type Verdict = "approved" | "rejected" | "no_consensus";

export interface DeliberationMessage {
	agent: AgentRole;
	agentLabel: string;
	message: string;
	round: number;
	timestamp: string;
}

export interface ProposedTrade {
	outcome: "Yes" | "No";
	amount: string; // USDC
	reasoning: string;
}

export interface CouncilDeliberation {
	id: string;
	market: MarketOpportunity;
	userReason?: string;
	rounds: DeliberationMessage[];
	votes: Record<AgentRole, VoteChoice>;
	verdict: Verdict;
	proposedTrade?: ProposedTrade;
	createdIntentId?: string;
	timestamp: string;
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const deliberations = new Map<string, CouncilDeliberation>();

export function getDeliberation(id: string): CouncilDeliberation | undefined {
	return deliberations.get(id);
}

export function listDeliberations(): CouncilDeliberation[] {
	return Array.from(deliberations.values()).sort(
		(a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
	);
}

// ---------------------------------------------------------------------------
// Agent system prompts
// ---------------------------------------------------------------------------

const AGENT_LABELS: Record<AgentRole, string> = {
	analyst: "📊 Analyst",
	riskManager: "🛡️ Risk Manager",
	contrarian: "🔥 Contrarian",
};

const SYSTEM_PROMPTS: Record<AgentRole, string> = {
	analyst: `You are the **Analyst** on a prediction market trading council. Your role:
- Evaluate market probabilities using fundamental analysis
- Identify value bets where market price diverges from true probability
- Use data-driven reasoning: polling, historical precedent, base rates
- Focus on expected value (EV) — is this trade +EV?
- Be specific about WHY you think the market is mispriced

Respond in 2-4 concise paragraphs. End with:
VOTE: APPROVE / REJECT / ABSTAIN
If approving, state which outcome (Yes/No) you'd bet on and why.`,

	riskManager: `You are the **Risk Manager** on a prediction market trading council. Your role:
- Evaluate downside risk and worst-case scenarios
- Propose appropriate position sizing in USDC (conservative: $10-50, moderate: $50-200, aggressive: $200-500)
- Consider market liquidity, time to resolution, and correlation risk
- Flag any red flags: low liquidity, ambiguous resolution criteria, manipulation risk
- Your sizing decision is final — you own the capital allocation

Respond in 2-4 concise paragraphs. End with:
VOTE: APPROVE / REJECT / ABSTAIN
POSITION SIZE: $XX USDC (if approving)
If approving, state the outcome (Yes/No) and exact $ amount.`,

	contrarian: `You are the **Contrarian** on a prediction market trading council. Your role:
- Play devil's advocate — challenge the consensus
- Identify cognitive biases: anchoring, recency bias, bandwagon effect
- Point out what could go wrong that others might miss
- Consider adversarial scenarios: market manipulation, resolution disputes
- Ask "what would have to be true for the opposite outcome?"

Respond in 2-4 concise paragraphs. End with:
VOTE: APPROVE / REJECT / ABSTAIN
If you still approve despite your objections, explain what convinced you.`,
};

// ---------------------------------------------------------------------------
// OpenAI client
// ---------------------------------------------------------------------------

function getOpenAIClient(): OpenAI {
	// Support Gemini (via OpenAI-compatible endpoint) or OpenAI
	const geminiKey = process.env.GEMINI_API_KEY;
	const openaiKey = process.env.OPENAI_API_KEY;

	if (geminiKey) {
		console.log("[Council] Using Google Gemini API");
		return new OpenAI({
			apiKey: geminiKey,
			baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
		});
	}

	if (openaiKey) {
		console.log("[Council] Using OpenAI API");
		return new OpenAI({ apiKey: openaiKey });
	}

	throw new Error(
		"GEMINI_API_KEY or OPENAI_API_KEY environment variable is required for Agent Council",
	);
}

/** Default model — override with LLM_MODEL env var */
const DEFAULT_MODEL = process.env.LLM_MODEL || (process.env.GEMINI_API_KEY ? "gemini-2.0-flash" : "gpt-4o");

async function askAgent(
	client: OpenAI,
	role: AgentRole,
	marketContext: string,
	previousMessages: DeliberationMessage[],
	round: number,
): Promise<string> {
	const messages: OpenAI.ChatCompletionMessageParam[] = [
		{ role: "system", content: SYSTEM_PROMPTS[role] },
		{ role: "user", content: marketContext },
	];

	// Add previous round messages for context in round 2
	if (previousMessages.length > 0) {
		const otherMessages = previousMessages
			.filter((m) => m.agent !== role)
			.map((m) => `[${m.agentLabel}]: ${m.message}`)
			.join("\n\n---\n\n");

		messages.push({
			role: "user",
			content: `Here are the other council members' opinions from the previous round:\n\n${otherMessages}\n\nNow give your response for round ${round}, considering the other perspectives.`,
		});
	}

	const completion = await client.chat.completions.create({
		model: DEFAULT_MODEL,
		messages,
		temperature: 0.7,
		max_tokens: 800,
	});

	return completion.choices[0]?.message?.content ?? "(no response)";
}

// ---------------------------------------------------------------------------
// Vote parsing
// ---------------------------------------------------------------------------

function parseVote(message: string): VoteChoice {
	const upper = message.toUpperCase();
	// Look for the pattern VOTE: APPROVE/REJECT/ABSTAIN
	const voteMatch = /VOTE:\s*(APPROVE|REJECT|ABSTAIN)/i.exec(upper);
	if (voteMatch?.[1]) {
		return voteMatch[1].toLowerCase() as VoteChoice;
	}
	// Fallback: look for keywords in the last paragraph
	const lastParagraph = message.split("\n").filter(Boolean).pop()?.toUpperCase() ?? "";
	if (lastParagraph.includes("APPROVE")) return "approve";
	if (lastParagraph.includes("REJECT")) return "reject";
	return "abstain";
}

function parseProposedTrade(
	messages: DeliberationMessage[],
): ProposedTrade | undefined {
	// Extract trade proposal from Risk Manager's message
	const riskMsg = messages.find((m) => m.agent === "riskManager");
	if (!riskMsg) return undefined;

	const text = riskMsg.message;

	// Parse outcome
	let outcome: "Yes" | "No" = "Yes";
	if (/outcome.*no\b/i.test(text) || /\bbet.*no\b/i.test(text) || /\bbuy.*no\b/i.test(text)) {
		outcome = "No";
	}

	// Parse amount from POSITION SIZE: $XX
	let amount = "50"; // default
	const sizeMatch = /POSITION\s*SIZE:\s*\$?(\d+)/i.exec(text);
	if (sizeMatch?.[1]) {
		amount = sizeMatch[1];
	} else {
		// Fallback: look for dollar amounts
		const dollarMatch = /\$(\d+)\s*(?:USDC|usd)/i.exec(text);
		if (dollarMatch?.[1]) {
			amount = dollarMatch[1];
		}
	}

	// Build reasoning from all approving agents
	const approveMessages = messages
		.filter((m) => parseVote(m.message) === "approve")
		.map((m) => `${m.agentLabel}: ${m.message.split("\n")[0]}`)
		.join(" | ");

	return {
		outcome,
		amount,
		reasoning: approveMessages || riskMsg.message.split("\n")[0] || "Council approved",
	};
}

// ---------------------------------------------------------------------------
// Main deliberation function
// ---------------------------------------------------------------------------

/**
 * Run a full council deliberation on a market opportunity.
 * Returns the deliberation result with verdict and optional trade proposal.
 */
export async function deliberate(
	market: MarketOpportunity,
	userReason?: string,
): Promise<CouncilDeliberation> {
	const client = getOpenAIClient();
	const deliberationId = `dlb_${uuidv4().slice(0, 8)}`;

	const deliberation: CouncilDeliberation = {
		id: deliberationId,
		market,
		userReason,
		rounds: [],
		votes: { analyst: "abstain", riskManager: "abstain", contrarian: "abstain" },
		verdict: "no_consensus",
		timestamp: new Date().toISOString(),
	};

	// Build market context prompt
	const outcomesStr = market.outcomes
		.map((o) => `  - ${o.name}: ${(o.price * 100).toFixed(1)}%`)
		.join("\n");

	const marketContext = `## Trading Opportunity

**Market:** ${market.question}
**Condition ID:** ${market.conditionId}

**Outcomes & Prices:**
${outcomesStr}

**24h Volume:** $${market.volume24h.toLocaleString()}
**Liquidity:** $${market.liquidity.toLocaleString()}
**End Date:** ${market.endDate}
**Signal:** ${market.signal} (strength: ${market.signalStrength}/100)
**Scanner Memo:** ${market.memo}
${userReason ? `\n**Agent Reason:** ${userReason}` : ""}

Should we take a position on this market? If so, which outcome and how much?`;

	console.log(`\n╔══════════════════════════════════════════════════════════╗`);
	console.log(`║  🧑‍⚖️ AGENT COUNCIL — Deliberation Starting              ║`);
	console.log(`║  ID: ${deliberationId}`);
	console.log(`║  Market: ${market.question}`);
	console.log(`║  Condition ID: ${market.conditionId}`);
	const outcomesLog = market.outcomes.map(o => `${o.name}: ${(o.price * 100).toFixed(1)}%`).join(" | ");
	console.log(`║  Outcomes: ${outcomesLog}`);
	console.log(`║  Volume: $${market.volume24h.toLocaleString()} | Liquidity: $${market.liquidity.toLocaleString()}`);
	console.log(`║  Signal: ${market.signal} (${market.signalStrength}/100)`);
	if (userReason) console.log(`║  Reason: ${userReason}`);
	console.log(`╚══════════════════════════════════════════════════════════╝`);

	const deliberationStart = Date.now();

	// --- Round 1: Initial opinions ---
	console.log(`\n[Council] ─── ROUND 1: Initial Opinions ─────────────────────`);
	const agents: AgentRole[] = ["analyst", "riskManager", "contrarian"];

	for (const agent of agents) {
		console.log(`[Council] 🤔 ${AGENT_LABELS[agent]} is thinking...`);
		const agentStart = Date.now();
		try {
			const response = await askAgent(client, agent, marketContext, [], 1);
			const elapsed = ((Date.now() - agentStart) / 1000).toFixed(1);
			const msg: DeliberationMessage = {
				agent,
				agentLabel: AGENT_LABELS[agent],
				message: response,
				round: 1,
				timestamp: new Date().toISOString(),
			};
			deliberation.rounds.push(msg);
			// Log the full response
			console.log(`[Council] ✅ ${AGENT_LABELS[agent]} responded (${elapsed}s):`);
			console.log(`[Council]   ┌────────────────────────────────────────────`);
			for (const line of response.split("\n")) {
				console.log(`[Council]   │ ${line}`);
			}
			console.log(`[Council]   └────────────────────────────────────────────`);
		} catch (err) {
			const elapsed = ((Date.now() - agentStart) / 1000).toFixed(1);
			console.error(`[Council] ❌ ${AGENT_LABELS[agent]} ERROR after ${elapsed}s:`, err instanceof Error ? err.message : err);
			deliberation.rounds.push({
				agent,
				agentLabel: AGENT_LABELS[agent],
				message: `(Agent error: ${err instanceof Error ? err.message : "unknown"}).\nVOTE: ABSTAIN`,
				round: 1,
				timestamp: new Date().toISOString(),
			});
		}
	}

	// --- Round 2: Cross-reactions ---
	console.log(`\n[Council] ─── ROUND 2: Cross-Reactions ──────────────────────`);
	const round1Messages = deliberation.rounds.filter((m) => m.round === 1);

	for (const agent of agents) {
		console.log(`[Council] 🤔 ${AGENT_LABELS[agent]} is reviewing other opinions...`);
		const agentStart = Date.now();
		try {
			const response = await askAgent(client, agent, marketContext, round1Messages, 2);
			const elapsed = ((Date.now() - agentStart) / 1000).toFixed(1);
			const msg: DeliberationMessage = {
				agent,
				agentLabel: AGENT_LABELS[agent],
				message: response,
				round: 2,
				timestamp: new Date().toISOString(),
			};
			deliberation.rounds.push(msg);
			// Log the full response
			console.log(`[Council] ✅ ${AGENT_LABELS[agent]} responded (${elapsed}s):`);
			console.log(`[Council]   ┌────────────────────────────────────────────`);
			for (const line of response.split("\n")) {
				console.log(`[Council]   │ ${line}`);
			}
			console.log(`[Council]   └────────────────────────────────────────────`);
		} catch (err) {
			const elapsed = ((Date.now() - agentStart) / 1000).toFixed(1);
			console.error(`[Council] ❌ ${AGENT_LABELS[agent]} ERROR in round 2 after ${elapsed}s:`, err instanceof Error ? err.message : err);
			deliberation.rounds.push({
				agent,
				agentLabel: AGENT_LABELS[agent],
				message: `(Agent error in round 2).\nVOTE: ABSTAIN`,
				round: 2,
				timestamp: new Date().toISOString(),
			});
		}
	}

	// --- Parse votes from round 2 (final opinions) ---
	console.log(`\n[Council] ─── VOTE RESULTS ────────────────────────────────`);
	const round2Messages = deliberation.rounds.filter((m) => m.round === 2);
	for (const msg of round2Messages) {
		deliberation.votes[msg.agent] = parseVote(msg.message);
		const voteEmoji = deliberation.votes[msg.agent] === "approve" ? "✅" : deliberation.votes[msg.agent] === "reject" ? "❌" : "⏸️";
		console.log(`[Council]   ${voteEmoji} ${msg.agentLabel}: ${deliberation.votes[msg.agent].toUpperCase()}`);
	}

	// --- Compute verdict (2/3 majority) ---
	const approveCount = Object.values(deliberation.votes).filter((v) => v === "approve").length;
	const rejectCount = Object.values(deliberation.votes).filter((v) => v === "reject").length;
	const totalTime = ((Date.now() - deliberationStart) / 1000).toFixed(1);

	console.log(`\n[Council] ══════════════════════════════════════════════`);
	if (approveCount >= 2) {
		deliberation.verdict = "approved";
		deliberation.proposedTrade = parseProposedTrade(round2Messages);
		console.log(`[Council] ✅ VERDICT: APPROVED (${approveCount}/3 approve votes)`);
		console.log(`[Council]   Trade: ${deliberation.proposedTrade?.outcome} ${deliberation.proposedTrade?.amount} USDC`);
		console.log(`[Council]   Reasoning: ${deliberation.proposedTrade?.reasoning?.slice(0, 120)}...`);
	} else if (rejectCount >= 2) {
		deliberation.verdict = "rejected";
		console.log(`[Council] ❌ VERDICT: REJECTED (${rejectCount}/3 reject votes)`);
	} else {
		deliberation.verdict = "no_consensus";
		console.log(`[Council] ⚖️ VERDICT: NO CONSENSUS`);
		console.log(`[Council]   Votes: ${JSON.stringify(deliberation.votes)}`);
	}
	console.log(`[Council]   Total deliberation time: ${totalTime}s`);
	console.log(`[Council] ══════════════════════════════════════════════\n`);

	// Store in memory
	deliberations.set(deliberationId, deliberation);

	return deliberation;
}

/**
 * Run deliberation and auto-create an intent if approved.
 * Returns the deliberation + created intent ID if applicable.
 */
export async function deliberateAndPropose(
	market: MarketOpportunity,
	userReason?: string,
	createIntentFn?: (trade: ProposedTrade, market: MarketOpportunity) => string,
): Promise<CouncilDeliberation> {
	const deliberation = await deliberate(market, userReason);

	if (
		deliberation.verdict === "approved" &&
		deliberation.proposedTrade &&
		createIntentFn
	) {
		const intentId = createIntentFn(deliberation.proposedTrade, market);
		deliberation.createdIntentId = intentId;
		console.log(`[Council] Intent created: ${intentId}`);
	}

	return deliberation;
}
