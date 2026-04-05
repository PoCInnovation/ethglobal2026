/**
 * MCP Server — Model Context Protocol server for Polymarket trading tools.
 *
 * Exposes 6 tools for LLM agents (Claude, ChatGPT, etc.):
 *   - scan_polymarket_markets  : List active markets with trading signals
 *   - get_market_details       : Detailed info for a specific market
 *   - propose_trade            : Submit a trade → council deliberates → intent created
 *   - get_council_opinion      : Get council opinion without creating a trade
 *   - list_pending_trades      : List polymarket_trade intents in the queue
 *   - get_deliberation         : View details of a past deliberation
 *
 * Usage:
 *   npx tsx src/mcp-server.ts          (stdio mode — for Claude Desktop, etc.)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
	deliberateAndPropose,
	deliberate,
	getDeliberation,
	listDeliberations,
} from "./agent-council.js";
import { scanMarkets, getMarketDetails, isMarketEndDateStillValid } from "./polymarket-scanner.js";

// ---------------------------------------------------------------------------
// Intent creation helper (inline — no HTTP round-trip)
// ---------------------------------------------------------------------------

import type { MarketOpportunity } from "./polymarket-scanner.js";
import type { ProposedTrade } from "./agent-council.js";
import type { Intent, PolymarketTradeDetails } from "@agent-intents/shared";
import { v4 as uuidv4 } from "uuid";

// In-memory intent store (shared concept — for MCP standalone mode)
const mcpIntents = new Map<string, Intent>();

function createPolymarketIntent(
	trade: ProposedTrade,
	market: MarketOpportunity,
): string {
	const now = new Date().toISOString();
	const id = `int_${Date.now()}_${uuidv4().slice(0, 8)}`;

	const selectedOutcome = market.outcomes.find(
		(o) => o.name.toLowerCase() === trade.outcome.toLowerCase(),
	);

	const details: PolymarketTradeDetails = {
		type: "polymarket_trade",
		conditionId: market.conditionId,
		marketTitle: market.question,
		outcome: trade.outcome,
		amount: trade.amount,
		outcomePrice: selectedOutcome?.price,
		tokenId: selectedOutcome?.tokenId,
		chainId: 137,
		memo: trade.reasoning,
	};

	const intent: Intent = {
		id,
		userId: "mcp-agent",
		agentId: "council",
		agentName: "Agent Council",
		details,
		urgency: "normal",
		status: "pending",
		createdAt: now,
		expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
		statusHistory: [{ status: "pending", timestamp: now }],
	};

	mcpIntents.set(id, intent);

	// Also POST to the backend if it's running
	postIntentToBackend(intent).catch(() => {
		/* best effort */
	});

	return id;
}

async function postIntentToBackend(intent: Intent): Promise<void> {
	const backendUrl = process.env.BACKEND_URL || "http://localhost:3005";
	try {
		await fetch(`${backendUrl}/api/intents`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				userId: intent.userId,
				agentId: intent.agentId,
				agentName: intent.agentName,
				details: intent.details,
				urgency: intent.urgency,
			}),
		});
	} catch {
		// Backend might not be running — that's fine in MCP standalone mode
	}
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
	name: "polymarket-council",
	version: "1.0.0",
});

// Tool 1: Scan markets
server.tool(
	"scan_polymarket_markets",
	"Scan active Polymarket prediction markets and detect trading opportunities (mispricing, momentum, volume spikes). Returns up to 20 markets sorted by chosen criteria.",
	{
		limit: z.number().min(1).max(50).default(20).describe("Number of markets to return"),
		sortBy: z
			.enum(["volume", "liquidity", "signal", "endDate"])
			.default("volume")
			.describe("How to sort results"),
	},
	async ({ limit, sortBy }) => {
		try {
			const markets = await scanMarkets({ limit, sortBy });
			const summary = markets
				.map((m, i) => {
					const prices = m.outcomes
						.map((o) => `${o.name}: ${(o.price * 100).toFixed(1)}%`)
						.join(" | ");
					return `${i + 1}. **${m.question}**\n   ${prices}\n   Signal: ${m.signal} (${m.signalStrength}/100) — ${m.memo}\n   Volume: $${m.volume24h.toLocaleString()} | Liquidity: $${m.liquidity.toLocaleString()}\n   Condition ID: ${m.conditionId}`;
				})
				.join("\n\n");

			return {
				content: [
					{
						type: "text" as const,
						text: `# Polymarket Markets (${markets.length} results)\n\n${summary}`,
					},
				],
			};
		} catch (err) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Error scanning markets: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				isError: true,
			};
		}
	},
);

// Tool 2: Get market details
server.tool(
	"get_market_details",
	"Get detailed information about a specific Polymarket market by its condition ID.",
	{
		conditionId: z
			.string()
			.describe("The Polymarket condition ID (bytes32 hex string)"),
	},
	async ({ conditionId }) => {
		try {
			const market = await getMarketDetails(conditionId);
			if (!market) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Market not found: ${conditionId}`,
						},
					],
					isError: true,
				};
			}

			const prices = market.outcomes
				.map(
					(o) =>
						`- **${o.name}**: ${(o.price * 100).toFixed(1)}% (token: ${o.tokenId.slice(0, 12)}...)`,
				)
				.join("\n");

			return {
				content: [
					{
						type: "text" as const,
						text: `# ${market.question}\n\n**Condition ID:** ${market.conditionId}\n**Active:** ${market.active}\n**End Date:** ${market.endDate}\n\n## Outcomes\n${prices}\n\n## Market Data\n- Volume 24h: $${market.volume24h.toLocaleString()}\n- Liquidity: $${market.liquidity.toLocaleString()}\n- Signal: ${market.signal} (${market.signalStrength}/100)\n- ${market.memo}`,
					},
				],
			};
		} catch (err) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Error fetching market: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				isError: true,
			};
		}
	},
);

// Tool 3: Propose trade
server.tool(
	"propose_trade",
	"Propose a trade on a Polymarket market. The Agent Council (Analyst, Risk Manager, Contrarian) will deliberate and vote. If 2/3 approve, a trade intent is created for the user to sign on their Ledger.",
	{
		conditionId: z
			.string()
			.describe("The Polymarket condition ID to trade on"),
		outcome: z
			.enum(["Yes", "No"])
			.describe("Which outcome to bet on"),
		reason: z
			.string()
			.describe("Your reasoning for this trade — will be presented to the council"),
	},
	async ({ conditionId, outcome, reason }) => {
		try {
			const market = await getMarketDetails(conditionId);
			if (!market) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Market not found: ${conditionId}`,
						},
					],
					isError: true,
				};
			}

			if (!isMarketEndDateStillValid(market.endDate)) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Market is outdated or resolves too soon (endDate: ${market.endDate}). Use scan_polymarket_markets for current opportunities.`,
						},
					],
					isError: true,
				};
			}

			const deliberation = await deliberateAndPropose(
				market,
				`Agent proposes ${outcome} — ${reason}`,
				createPolymarketIntent,
			);

			const roundsSummary = deliberation.rounds
				.map((r) => `**${r.agentLabel}** (Round ${r.round}):\n${r.message}`)
				.join("\n\n---\n\n");

			const voteSummary = Object.entries(deliberation.votes)
				.map(([agent, vote]) => `- ${agent}: ${vote.toUpperCase()}`)
				.join("\n");

			let result = `# Council Deliberation: ${market.question}\n\n## Verdict: ${deliberation.verdict.toUpperCase()}\n\n## Votes\n${voteSummary}\n\n`;

			if (deliberation.proposedTrade) {
				result += `## Proposed Trade\n- Outcome: **${deliberation.proposedTrade.outcome}**\n- Amount: **${deliberation.proposedTrade.amount} USDC**\n- Reasoning: ${deliberation.proposedTrade.reasoning}\n\n`;
			}

			if (deliberation.createdIntentId) {
				result += `## ✅ Intent Created\nIntent ID: \`${deliberation.createdIntentId}\`\nThe trade has been queued for user approval and Ledger signing.\n\n`;
			}

			result += `## Full Deliberation\n\n${roundsSummary}`;

			return {
				content: [{ type: "text" as const, text: result }],
			};
		} catch (err) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Error during deliberation: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				isError: true,
			};
		}
	},
);

// Tool 4: Get council opinion (no trade)
server.tool(
	"get_council_opinion",
	"Ask the Agent Council for their opinion on a market opportunity WITHOUT creating a trade intent. Useful for analysis before committing.",
	{
		conditionId: z
			.string()
			.describe("The Polymarket condition ID"),
		question: z
			.string()
			.optional()
			.describe("Optional specific question to ask the council"),
	},
	async ({ conditionId, question }) => {
		try {
			const market = await getMarketDetails(conditionId);
			if (!market) {
				return {
					content: [
						{ type: "text" as const, text: `Market not found: ${conditionId}` },
					],
					isError: true,
				};
			}

			const deliberation = await deliberate(
				market,
				question || "Analyze this opportunity",
			);

			const roundsSummary = deliberation.rounds
				.map((r) => `**${r.agentLabel}** (Round ${r.round}):\n${r.message}`)
				.join("\n\n---\n\n");

			const voteSummary = Object.entries(deliberation.votes)
				.map(([agent, vote]) => `- ${agent}: ${vote.toUpperCase()}`)
				.join("\n");

			return {
				content: [
					{
						type: "text" as const,
						text: `# Council Opinion: ${market.question}\n\n## Verdict: ${deliberation.verdict.toUpperCase()}\n\n## Votes\n${voteSummary}\n\n## Discussion\n\n${roundsSummary}`,
					},
				],
			};
		} catch (err) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Error: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				isError: true,
			};
		}
	},
);

// Tool 5: List pending trades
server.tool(
	"list_pending_trades",
	"List all polymarket_trade intents currently in the queue (pending Ledger signing).",
	{},
	async () => {
		try {
			// Fetch from backend API
			const backendUrl = process.env.BACKEND_URL || "http://localhost:3005";
			const res = await fetch(`${backendUrl}/api/debug/intents`);
			const data = (await res.json()) as { intents: Intent[] };

			const polyTrades = (data.intents || []).filter(
				(i: Intent) => i.details.type === "polymarket_trade",
			);

			if (polyTrades.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No polymarket trade intents in the queue.",
						},
					],
				};
			}

			const summary = polyTrades
				.map((i: Intent) => {
					const d = i.details as PolymarketTradeDetails;
					return `- **${d.marketTitle}** — ${d.outcome} ${d.amount} USDC\n  Status: ${i.status} | Created: ${i.createdAt}\n  Intent ID: ${i.id}`;
				})
				.join("\n\n");

			return {
				content: [
					{
						type: "text" as const,
						text: `# Pending Polymarket Trades (${polyTrades.length})\n\n${summary}`,
					},
				],
			};
		} catch (err) {
			// Fallback to local MCP intents
			const local = Array.from(mcpIntents.values()).filter(
				(i) => i.details.type === "polymarket_trade",
			);

			if (local.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No polymarket trade intents found (backend may be offline).",
						},
					],
				};
			}

			const summary = local
				.map((i) => {
					const d = i.details as PolymarketTradeDetails;
					return `- **${d.marketTitle}** — ${d.outcome} ${d.amount} USDC (${i.status})`;
				})
				.join("\n");

			return {
				content: [
					{
						type: "text" as const,
						text: `# Local Pending Trades (${local.length})\n\n${summary}\n\n_Note: Backend may be offline. Showing MCP-local intents only._`,
					},
				],
			};
		}
	},
);

// Tool 6: Get deliberation
server.tool(
	"get_deliberation",
	"View the full details of a past council deliberation by its ID.",
	{
		deliberationId: z
			.string()
			.describe("The deliberation ID (dlb_...)"),
	},
	async ({ deliberationId }) => {
		const d = getDeliberation(deliberationId);
		if (!d) {
			// Try listing all to help the user
			const all = listDeliberations();
			const ids = all.map((x) => x.id).join(", ");
			return {
				content: [
					{
						type: "text" as const,
						text: `Deliberation '${deliberationId}' not found.\n\nAvailable deliberations: ${ids || "(none)"}`,
					},
				],
				isError: true,
			};
		}

		const roundsSummary = d.rounds
			.map((r) => `**${r.agentLabel}** (Round ${r.round}):\n${r.message}`)
			.join("\n\n---\n\n");

		const voteSummary = Object.entries(d.votes)
			.map(([agent, vote]) => `- ${agent}: ${vote.toUpperCase()}`)
			.join("\n");

		let text = `# Deliberation: ${d.market.question}\n\n**ID:** ${d.id}\n**Timestamp:** ${d.timestamp}\n**Verdict:** ${d.verdict.toUpperCase()}\n\n## Votes\n${voteSummary}\n\n`;

		if (d.proposedTrade) {
			text += `## Trade Proposal\n- Outcome: ${d.proposedTrade.outcome}\n- Amount: ${d.proposedTrade.amount} USDC\n- Reasoning: ${d.proposedTrade.reasoning}\n\n`;
		}

		if (d.createdIntentId) {
			text += `## Intent: \`${d.createdIntentId}\`\n\n`;
		}

		text += `## Full Discussion\n\n${roundsSummary}`;

		return {
			content: [{ type: "text" as const, text }],
		};
	},
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("[MCP] Polymarket Council server running (stdio)");
}

main().catch((err) => {
	console.error("[MCP] Fatal error:", err);
	process.exit(1);
});
