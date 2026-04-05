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
 *   4. Vote: APPROVE / REJECT / ABSTAIN — YOLO: approve unless ≥2 REJECT
 *   5. If approved → create polymarket_trade intent
 */

import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { createLlmOpenAIClient, defaultLlmModel } from "./llm-openai-client.js";
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

export const AGENT_LABELS: Record<AgentRole, string> = {
	analyst: "📊 Analyst",
	riskManager: "🛡️ Risk Manager",
	contrarian: "🔥 Contrarian",
};

const DEFAULT_COUNCIL_TRADING_BANKROLL_USDC = 500;
const MIN_SINGLE_TRADE_USDC = 5;

/** Demo council: random ticket between $10 and $40 USDC (inclusive), picked once per deliberation. */
export function randomDemoPositionUsdc(): number {
	return 10 + Math.floor(Math.random() * 31);
}

/**
 * Max USDC the council may allocate on one trade (env: COUNCIL_TRADING_BANKROLL_USDC).
 * The Risk Manager sizes positions as a % of this bankroll from an opportunity score /100.
 */
export function getCouncilTradingBankrollUsdc(): number {
	const raw = process.env.COUNCIL_TRADING_BANKROLL_USDC;
	if (!raw?.trim()) return DEFAULT_COUNCIL_TRADING_BANKROLL_USDC;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n < MIN_SINGLE_TRADE_USDC) {
		return DEFAULT_COUNCIL_TRADING_BANKROLL_USDC;
	}
	return n;
}

/**
 * Hackathon / demo mode: rubber-stamp almost everything. Models still talk, but votes default APPROVE.
 */
export const SYSTEM_PROMPTS: Record<AgentRole, string> = {
	analyst: `You are a **rubber-stamp Analyst** for a demo prediction-market council.

Rules:
- **LINE 1 MUST be exactly:** \`VOTE: APPROVE\` — use REJECT only if the market is literally broken (no resolution possible, obvious scam). Otherwise always APPROVE.
- Lines 2–4: max 3 short sentences. Say which side (Yes or No) looks slightly more fun to trade and one fake-sounding reason.

Never use ABSTAIN. Never write a long essay.`,

	riskManager: `You are a **rubber-stamp Risk Manager** for a demo prediction-market council.

Rules:
- **LINE 1 MUST be exactly:** \`VOTE: APPROVE\`
- **Lines 2–5 MUST be exactly:**
\`OPPORTUNITY SCORE: 60/100\`
\`ALLOCATION PCT: YY\`  (YY = any integer 1–25, cosmetic only for this demo)
\`POSITION SIZE: $ZZ USDC\`  (**ZZ must be exactly the integer** shown in the user message under **Demo position size** — copy it digit-for-digit, do not recalculate from bankroll)
- Line 6: one sentence — which outcome (Yes or No); mention the ticket is a small random demo size.

Each deliberation gets a **new random $10–$40** demo size in the user prompt — always mirror that number in POSITION SIZE.

REJECT only if the market cannot resolve. Never ABSTAIN. No paragraphs before line 1.`,

	contrarian: `You are a **tame Contrarian** for a demo prediction-market council.

Rules:
- **LINE 1 MUST be exactly:** \`VOTE: APPROVE\`
- Lines 2–3: mention one silly risk, then say we still greenlight for demo purposes.

Never REJECT unless the market is an obvious scam. Never ABSTAIN.`,
};

// ---------------------------------------------------------------------------
// OpenAI client (Gemini uses Google OpenAI-compat baseURL — see llm-openai-client.ts)
// ---------------------------------------------------------------------------

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
			content: `Here are the other council members' opinions from the previous round:\n\n${otherMessages}\n\nNow give your response for round ${round}, considering the other perspectives.${round === 2 ? "\n\n---\nROUND 2 CRITICAL: Your **first line** must be \`VOTE: APPROVE\`, \`VOTE: REJECT\`, or \`VOTE: ABSTAIN\` (prefer APPROVE). Put it before any other text so it is not cut off." : ""}`,
		});
	}

	const completion = await client.chat.completions.create({
		model: defaultLlmModel(),
		messages,
		temperature: 0.9,
		max_tokens: round === 2 ? 1024 : 600,
	});

	return completion.choices[0]?.message?.content ?? "(no response)";
}

// ---------------------------------------------------------------------------
// Vote parsing
// ---------------------------------------------------------------------------

function parseVote(message: string): VoteChoice {
	const upper = message.toUpperCase();
	// Anywhere in the message (handles markdown, bold, colons)
	const allVotes = [
		...upper.matchAll(/\bVOTE\b\s*[:.]?\s*\*?\*?(APPROVE|REJECT|ABSTAIN)\b/gi),
	];
	if (allVotes.length > 0) {
		const raw = allVotes[allVotes.length - 1]?.[1];
		if (raw) return raw.toLowerCase() as VoteChoice;
	}
	// First line often has the vote
	const head = upper.slice(0, 400);
	if (/\bAPPROVE\b/.test(head) && !/\bVOTE\b.*\bREJECT\b/.test(head)) return "approve";
	if (/\bREJECT\b/.test(head)) return "reject";
	if (/\bABSTAIN\b/.test(head)) return "abstain";
	// YOLO: models skip the format → count as approve so the demo flow does not stall
	return "approve";
}

function clampInt(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

/** Default side for binary Yes/No: lean underdog for a tiny +EV story (demo). */
function inferBinaryOutcomeFromMarket(market: MarketOpportunity): "Yes" | "No" {
	const yes = market.outcomes.find((o) => o.name.toLowerCase() === "yes");
	const no = market.outcomes.find((o) => o.name.toLowerCase() === "no");
	if (yes && no) {
		return yes.price <= no.price ? "Yes" : "No";
	}
	return "Yes";
}

function parseProposedTrade(
	messages: DeliberationMessage[],
	bankrollUsdc: number,
	market: MarketOpportunity,
	demoPositionUsdc: number,
): ProposedTrade | undefined {
	const riskMsg = messages.find((m) => m.agent === "riskManager");
	if (!riskMsg) return undefined;

	const text = riskMsg.message;

	let outcome: "Yes" | "No" = inferBinaryOutcomeFromMarket(market);
	if (/\bbet\s+on\s+no\b/i.test(text) || /\bposition:\s*no\b/i.test(text) || /\boutcome:\s*no\b/i.test(text)) {
		outcome = "No";
	} else if (/\bbet\s+on\s+yes\b/i.test(text) || /\bposition:\s*yes\b/i.test(text) || /\boutcome:\s*yes\b/i.test(text)) {
		outcome = "Yes";
	} else if (/outcome.*no\b/i.test(text) || /\bbuy.*no\b/i.test(text)) {
		outcome = "No";
	}

	const cappedDemo = clampInt(demoPositionUsdc, 10, 40);
	const amount = String(
		clampInt(cappedDemo, MIN_SINGLE_TRADE_USDC, Math.max(MIN_SINGLE_TRADE_USDC, bankrollUsdc)),
	);

	const approveMessages = messages
		.filter((m) => parseVote(m.message) === "approve")
		.map((m) => `${m.agentLabel}: ${m.message.split("\n")[0]}`)
		.join(" | ");

	return {
		outcome,
		amount,
		reasoning: approveMessages || riskMsg.message.split("\n")[0] || "Council approved (YOLO)",
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
	const client = createLlmOpenAIClient();
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

	const bankroll = getCouncilTradingBankrollUsdc();
	const demoPositionUsdc = randomDemoPositionUsdc();

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
**Trading bankroll (max you may allocate on one approved trade):** $${bankroll} USDC
**Demo position size (random $10–$40 for this run — Risk Manager must use exactly this for POSITION SIZE):** $${demoPositionUsdc} USDC
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

	const approveCount = Object.values(deliberation.votes).filter((v) => v === "approve").length;
	const rejectCount = Object.values(deliberation.votes).filter((v) => v === "reject").length;
	const totalTime = ((Date.now() - deliberationStart) / 1000).toFixed(1);
	const bankrollUsdc = getCouncilTradingBankrollUsdc();

	console.log(`\n[Council] ══════════════════════════════════════════════`);
	// YOLO: only a supermajority of rejects blocks; everything else approves
	if (rejectCount >= 2) {
		deliberation.verdict = "rejected";
		console.log(`[Council] ❌ VERDICT: REJECTED (${rejectCount}/3 reject votes)`);
	} else {
		deliberation.verdict = "approved";
		deliberation.proposedTrade =
			parseProposedTrade(round2Messages, bankrollUsdc, market, demoPositionUsdc) ??
			({
				outcome: inferBinaryOutcomeFromMarket(market),
				amount: String(
					clampInt(
						demoPositionUsdc,
						MIN_SINGLE_TRADE_USDC,
						Math.max(MIN_SINGLE_TRADE_USDC, bankrollUsdc),
					),
				),
				reasoning: "YOLO fallback — could not parse Risk Manager sizing",
			} satisfies ProposedTrade);
		console.log(
			`[Council] ✅ VERDICT: APPROVED (YOLO: ${approveCount} approve, ${rejectCount} reject — need 2+ reject to fail)`,
		);
		console.log(`[Council]   Trade: ${deliberation.proposedTrade?.outcome} ${deliberation.proposedTrade?.amount} USDC`);
		console.log(`[Council]   Reasoning: ${deliberation.proposedTrade?.reasoning?.slice(0, 120)}...`);
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
