#!/usr/bin/env node

/**
 * ledger-intent CLI — Submit transaction intents for Ledger signing
 *
 * Usage:
 *   ledger-intent send <amount> <token> to <address> [for "reason"] [--chain <id>] [--urgency <level>]
 *   ledger-intent status <intent-id>
 *   ledger-intent list [--status <status>]
 */

const API_URL = process.env.INTENT_API_URL || "http://localhost:3001";
const AGENT_ID = process.env.INTENT_AGENT_ID || "clouseau";
const AGENT_NAME = process.env.INTENT_AGENT_NAME || "Inspector Clouseau";
const USER_ID = process.env.INTENT_USER_ID || "demo-user";
const GAMMA_API_BASE = "https://gamma-api.polymarket.com";

// Token addresses by chain
const TOKENS = {
	1: {
		ETH: { address: null, decimals: 18 },
		USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
		USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
		DAI: { address: "0x6B175474E89094C44Da98b954EescdECD73A31F", decimals: 18 },
	},
	137: {
		MATIC: { address: null, decimals: 18 },
		USDC: { address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", decimals: 6 },
		USDT: { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
	},
	8453: {
		ETH: { address: null, decimals: 18 },
		USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
	},
};

async function main() {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command || command === "--help" || command === "-h") {
		printHelp();
		return;
	}

	switch (command) {
		case "send":
			await handleSend(args.slice(1));
			break;
		case "status":
			await handleStatus(args[1]);
			break;
		case "list":
			await handleList(args.slice(1));
			break;
		case "polymarket":
			await handlePolymarket(args.slice(1));
			break;
		default:
			console.error(`Unknown command: ${command}`);
			printHelp();
			process.exit(1);
	}
}

async function handleSend(args) {
	// Parse: <amount> <token> to <address> [for "reason"] [--chain <id>] [--urgency <level>]
	if (args.length < 4 || args[2] !== "to") {
		console.error('Usage: ledger-intent send <amount> <token> to <address> [for "reason"]');
		process.exit(1);
	}

	const amount = args[0];
	const token = args[1].toUpperCase();
	const recipient = args[3];

	// Parse optional arguments
	let memo = null;
	let chainId = 1;
	let urgency = "normal";

	for (let i = 4; i < args.length; i++) {
		if (args[i] === "for" && args[i + 1]) {
			memo = args[i + 1].replace(/^["']|["']$/g, "");
			i++;
		} else if (args[i] === "--chain" && args[i + 1]) {
			chainId = Number.parseInt(args[i + 1], 10);
			i++;
		} else if (args[i] === "--urgency" && args[i + 1]) {
			urgency = args[i + 1];
			i++;
		}
	}

	// Validate token
	const chainTokens = TOKENS[chainId];
	if (!chainTokens) {
		console.error(`Unsupported chain: ${chainId}`);
		process.exit(1);
	}

	const tokenInfo = chainTokens[token];
	if (!tokenInfo) {
		console.error(`Unsupported token ${token} on chain ${chainId}`);
		console.error(`Available: ${Object.keys(chainTokens).join(", ")}`);
		process.exit(1);
	}

	// Build intent
	const intent = {
		userId: USER_ID,
		agentId: AGENT_ID,
		agentName: AGENT_NAME,
		urgency,
		details: {
			type: "transfer",
			token,
			tokenAddress: tokenInfo.address,
			amount,
			recipient,
			chainId,
			memo,
		},
	};

	// Submit to backend
	try {
		const res = await fetch(`${API_URL}/api/intents`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(intent),
		});

		const data = await res.json();

		if (data.success) {
			console.log("✅ Intent created successfully");
			console.log("");
			console.log(`   ID:        ${data.intent.id}`);
			console.log(`   Amount:    ${amount} ${token}`);
			console.log(`   To:        ${recipient}`);
			if (memo) console.log(`   Reason:    ${memo}`);
			console.log(
				`   Chain:     ${chainId === 1 ? "Ethereum" : chainId === 137 ? "Polygon" : chainId === 8453 ? "Base" : chainId}`,
			);
			console.log(`   Status:    ${data.intent.status}`);
			console.log("");
			console.log("📱 Open Ledger Live → Agent Payments with Ledger to review and sign");
		} else {
			console.error(`❌ Failed: ${data.error}`);
			process.exit(1);
		}
	} catch (err) {
		console.error(`❌ Failed to connect to backend: ${err.message}`);
		console.error(`   Make sure the backend is running at ${API_URL}`);
		process.exit(1);
	}
}

async function handleStatus(intentId) {
	if (!intentId) {
		console.error("Usage: ledger-intent status <intent-id>");
		process.exit(1);
	}

	try {
		const res = await fetch(`${API_URL}/api/intents/${intentId}`);
		const data = await res.json();

		if (data.success) {
			const i = data.intent;
			console.log("");
			console.log(`Intent: ${i.id}`);
			console.log(`Type:   ${i.details.type}`);
			console.log(`Status: ${i.status}`);
			if (i.details.type === "polymarket_trade") {
				console.log(`Market: ${i.details.marketTitle || i.details.conditionId}`);
				console.log(`Outcome: ${i.details.outcome}`);
				console.log(`Amount: ${i.details.amount} USDC`);
				if (i.details.outcomePrice != null) {
					console.log(`Price:  ${(i.details.outcomePrice * 100).toFixed(1)}%`);
				}
			} else {
				console.log(`Amount: ${i.details.amount} ${i.details.token}`);
				console.log(`To:     ${i.details.recipient}`);
			}
			if (i.details.memo) console.log(`Reason: ${i.details.memo}`);
			if (i.txHash) console.log(`Tx:     ${i.txHash}`);
			if (i.txUrl) console.log(`View:   ${i.txUrl}`);
			console.log("");
		} else {
			console.error(`❌ ${data.error}`);
			process.exit(1);
		}
	} catch (err) {
		console.error(`❌ Failed: ${err.message}`);
		process.exit(1);
	}
}

async function handleList(args) {
	let status = null;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--status" && args[i + 1]) {
			status = args[i + 1];
			i++;
		}
	}

	try {
		let url = `${API_URL}/api/users/${USER_ID}/intents`;
		if (status) url += `?status=${status}`;

		const res = await fetch(url);
		const data = await res.json();

		if (data.success) {
			if (data.intents.length === 0) {
				console.log("No intents found.");
				return;
			}

			console.log("");
			for (const i of data.intents) {
				const statusIcon =
					{
						pending: "⏳",
						approved: "✓",
						broadcasting: "📡",
						confirmed: "✅",
						rejected: "✗",
						failed: "❌",
						expired: "⌛",
					}[i.status] || "?";

				console.log(`${statusIcon} ${i.id}`);
				if (i.details.type === "polymarket_trade") {
					console.log(
						`   ${i.details.amount} USDC → Polymarket: ${i.details.outcome} on ${(i.details.marketTitle || i.details.conditionId).slice(0, 40)}`,
					);
				} else {
					console.log(
						`   ${i.details.amount} ${i.details.token} → ${i.details.recipient.slice(0, 10)}...`,
					);
				}
				if (i.details.memo) console.log(`   "${i.details.memo}"`);
				console.log("");
			}
		} else {
			console.error(`❌ ${data.error}`);
			process.exit(1);
		}
	} catch (err) {
		console.error(`❌ Failed: ${err.message}`);
		process.exit(1);
	}
}

// =============================================================================
// Polymarket Commands
// =============================================================================

async function fetchActiveMarkets(limit = 50) {
	const url = `${GAMMA_API_BASE}/markets?active=true&closed=false&limit=${limit}&order=volume&ascending=false`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Gamma API error: ${res.status}`);
	return res.json();
}

function analyzeMarkets(markets) {
	return markets
		.filter((m) => m.active && !m.closed)
		.map((m) => {
			const tokens = m.tokens || [];
			const yesPrice = tokens[0]?.price ?? 0;
			const noPrice = tokens[1]?.price ?? 0;
			const spread = Math.abs(yesPrice - noPrice);
			return {
				conditionId: m.condition_id,
				question: m.question,
				yesPrice,
				noPrice,
				spread,
				volume: Number(m.volume || 0),
				endDate: m.end_date_iso,
			};
		})
		.sort((a, b) => b.volume - a.volume);
}

function formatMarketTable(markets) {
	const header = "  # │ YES    │ NO     │ Volume       │ Question";
	const separator = "────┼────────┼────────┼──────────────┼" + "─".repeat(50);
	console.log(header);
	console.log(separator);
	markets.slice(0, 20).forEach((m, i) => {
		const idx = String(i + 1).padStart(3);
		const yes = (m.yesPrice * 100).toFixed(1).padStart(5) + "%";
		const no = (m.noPrice * 100).toFixed(1).padStart(5) + "%";
		const vol = m.volume >= 1e6
			? `$${(m.volume / 1e6).toFixed(1)}M`.padStart(12)
			: `$${(m.volume / 1e3).toFixed(0)}K`.padStart(12);
		const q = m.question.length > 48 ? m.question.slice(0, 45) + "..." : m.question;
		console.log(`${idx} │ ${yes} │ ${no} │ ${vol} │ ${q}`);
	});
}

async function handlePolymarket(args) {
	const sub = args[0];

	if (!sub || sub === "--help") {
		console.log(`
polymarket sub-commands:
  analyze                                  Fetch top markets and display analysis
  list-markets                             List active markets with YES/NO prices
  buy YES|NO <conditionId> <amount> USDC   Create a polymarket_trade intent
`);
		return;
	}

	switch (sub) {
		case "analyze":
		case "list-markets": {
			try {
				const raw = await fetchActiveMarkets();
				const analyzed = analyzeMarkets(raw);
				if (analyzed.length === 0) {
					console.log("No active markets found.");
					return;
				}
				console.log("");
				console.log(sub === "analyze" ? "📊 Top Polymarket Markets by Volume:" : "📋 Active Markets:");
				console.log("");
				formatMarketTable(analyzed);
				console.log("");
				if (sub === "analyze") {
					console.log("💡 To place a trade:");
					console.log(`   ledger-intent polymarket buy YES <conditionId> 50 USDC`);
				}
			} catch (err) {
				console.error(`❌ Failed to fetch markets: ${err.message}`);
				process.exit(1);
			}
			break;
		}

		case "buy": {
			// polymarket buy YES|NO <conditionId> <amount> USDC
			const outcome = args[1];
			const conditionId = args[2];
			const amount = args[3];
			const tokenArg = args[4];

			if (!outcome || !conditionId || !amount) {
				console.error("Usage: ledger-intent polymarket buy YES|NO <conditionId> <amount> USDC");
				process.exit(1);
			}

			if (outcome !== "Yes" && outcome !== "No" && outcome !== "YES" && outcome !== "NO") {
				console.error("Outcome must be Yes or No");
				process.exit(1);
			}

			if (tokenArg && tokenArg.toUpperCase() !== "USDC") {
				console.error("Only USDC is supported for Polymarket trades");
				process.exit(1);
			}

			const normalizedOutcome = outcome.charAt(0).toUpperCase() + outcome.slice(1).toLowerCase();

			const intent = {
				agentId: AGENT_ID,
				agentName: AGENT_NAME,
				urgency: "normal",
				details: {
					type: "polymarket_trade",
					conditionId,
					outcome: normalizedOutcome,
					amount,
					chainId: 137,
					memo: `Agent ${AGENT_NAME} recommends ${normalizedOutcome} on ${conditionId}`,
				},
			};

			try {
				const res = await fetch(`${API_URL}/api/intents`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(intent),
				});

				const data = await res.json();

				if (data.success) {
					const d = data.intent.details;
					console.log("✅ Polymarket trade intent created");
					console.log("");
					console.log(`   ID:        ${data.intent.id}`);
					console.log(`   Market:    ${d.marketTitle || conditionId}`);
					console.log(`   Outcome:   ${d.outcome}`);
					console.log(`   Amount:    ${d.amount} USDC`);
					if (d.outcomePrice != null) {
						console.log(`   Price:     ${(d.outcomePrice * 100).toFixed(1)}%`);
					}
					console.log(`   Status:    ${data.intent.status}`);
					if (data.paymentUrl) {
						console.log(`   Review:    ${data.paymentUrl}`);
					}
					console.log("");
					console.log("📱 Open the web app to review and sign with your Ledger");
				} else {
					console.error(`❌ Failed: ${data.error}`);
					process.exit(1);
				}
			} catch (err) {
				console.error(`❌ Failed to connect to backend: ${err.message}`);
				console.error(`   Make sure the backend is running at ${API_URL}`);
				process.exit(1);
			}
			break;
		}

		default:
			console.error(`Unknown polymarket sub-command: ${sub}`);
			console.log('Try: ledger-intent polymarket --help');
			process.exit(1);
	}
}

function printHelp() {
	console.log(`
ledger-intent — Submit transaction intents for Ledger signing

USAGE:
  ledger-intent send <amount> <token> to <address> [for "reason"] [--chain <id>] [--urgency <level>]
  ledger-intent status <intent-id>
  ledger-intent list [--status <status>]
  ledger-intent polymarket analyze
  ledger-intent polymarket list-markets
  ledger-intent polymarket buy YES|NO <conditionId> <amount> USDC

EXAMPLES:
  ledger-intent send 50 USDC to 0x1234...5678 for "podcast intro music"
  ledger-intent send 0.5 ETH to vitalik.eth
  ledger-intent send 100 USDC to 0xabc...def --chain 137 --urgency high
  ledger-intent status int_1707048000_abc123
  ledger-intent list --status pending
  ledger-intent polymarket analyze
  ledger-intent polymarket buy Yes 0xabc...def 50 USDC

ENVIRONMENT:
  INTENT_API_URL    Backend URL (default: http://localhost:3001)
  INTENT_AGENT_ID   Agent identifier (default: clouseau)
  INTENT_AGENT_NAME Display name (default: Inspector Clouseau)
`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
