import { CodeBlock } from "@/components/ui";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/agent-context")({
	component: AgentContextPage,
	head: () => ({
		meta: [
			{ title: "Context for Agents | Polyledger" },
			{
				name: "description",
				content:
					"Quickstart guide for AI agents to create payment intents using a JSON credential file.",
			},
		],
	}),
});

// =============================================================================
// Section Components
// =============================================================================

function Section({
	id,
	title,
	children,
}: {
	id: string;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section id={id} className="scroll-mt-24">
			<h2 className="heading-4-semi-bold text-base mb-16 flex items-center gap-8">
				<span className="text-accent">#</span>
				{title}
			</h2>
			<div className="space-y-16">{children}</div>
		</section>
	);
}

// =============================================================================
// Main Page
// =============================================================================

function AgentContextPage() {
	return (
		<div className="flex gap-32 max-w-7xl mx-auto">
			{/* Sidebar Navigation */}
			<nav className="hidden lg:block w-[220px] flex-shrink-0 sticky top-24 h-fit">
				<div className="space-y-24">
				<div>
					<h4 className="body-4-semi-bold text-muted-subtle uppercase tracking-wider mb-8 px-12">
						Getting Started
					</h4>
					<NavLink href="#doc-mirror-hosting">Doc mirror (HTTPS)</NavLink>
					<NavLink href="#credential-file">Credential File</NavLink>
					<NavLink href="#agentauth-header">AgentAuth Header</NavLink>
					<NavLink href="#send-intent">Send a Transfer Intent</NavLink>
					<NavLink href="#poll">Poll for Completion</NavLink>
				</div>
				<div>
					<h4 className="body-4-semi-bold text-muted-subtle uppercase tracking-wider mb-8 px-12">
						Polymarket
					</h4>
					<NavLink href="#search-markets">Search Markets</NavLink>
					<NavLink href="#polymarket-trade">Create a Trade</NavLink>
				</div>
				<div>
					<h4 className="body-4-semi-bold text-muted-subtle uppercase tracking-wider mb-8 px-12">
						Examples
					</h4>
					<NavLink href="#complete-example">Transfer Script</NavLink>
					<NavLink href="#polymarket-example">Polymarket Script</NavLink>
				</div>
				<div>
					<h4 className="body-4-semi-bold text-muted-subtle uppercase tracking-wider mb-8 px-12">
						Reference
					</h4>
					<NavLink href="#supported-chains">Supported Chains</NavLink>
					<NavLink href="#troubleshooting">Troubleshooting</NavLink>
				</div>
				</div>
			</nav>

			{/* Main Content */}
			<main className="flex-1 min-w-0 space-y-48 pb-64">
				{/* Header */}
				<div className="space-y-16">
					<div className="flex items-center gap-12">
						<Link to="/" className="body-2 text-muted hover:text-base transition-colors">
							← Back to App
						</Link>
					</div>
					<div>
						<h1 className="heading-2-semi-bold text-base">Context for Agents</h1>
						<p className="body-1 text-muted mt-8">
							Quickstart guide for AI agents to create payment intents using a JSON credential file.
						</p>
					</div>
					<div className="flex items-center gap-16 p-16 rounded-md bg-accent/10">
						<p className="body-2 text-base">
							<strong>Prerequisites:</strong>{" "}
							<a
								href="https://nodejs.org/"
								target="_blank"
								rel="noopener noreferrer"
								className="text-accent hover:underline"
							>
								Node.js
							</a>{" "}
							(for AgentAuth via{" "}
							<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
								apps/web/scripts/agent-auth-header.mjs
							</code>
							),{" "}
							<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">curl</code>, and{" "}
							<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">jq</code>. Optional:{" "}
							<a
								href="https://book.getfoundry.sh/getting-started/installation"
								target="_blank"
								rel="noopener noreferrer"
								className="text-accent hover:underline"
							>
								Foundry
							</a>{" "}
							— do <strong>not</strong> use{" "}
							<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">cast keccak</code> for{" "}
							<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">bodyHash</code>.
						</p>
					</div>
				</div>

				{/* 0. Doc mirror hosting */}
				<Section id="doc-mirror-hosting" title="0. Public doc mirror (doc_ethcc.vibecallin.com)">
					<p className="body-2 text-muted">
						If you mirror this page or{" "}
						<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">agent-context.json</code> on
						a public host: enable <strong>TLS</strong>, redirect <strong>HTTP → HTTPS</strong>, add{" "}
						<strong>HSTS</strong> once HTTPS is stable, and serve the JSON with{" "}
						<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
							Content-Type: application/json
						</code>
						.
					</p>
					<p className="body-2 text-muted mt-8">
						Canonical mirror (use <code className="px-4 py-2 rounded-xs bg-muted text-base body-3">https://</code>{" "}
						only):{" "}
						<a
							href="https://doc_ethcc.vibecallin.com/agent-context"
							className="text-accent hover:underline"
							target="_blank"
							rel="noopener noreferrer"
						>
							https://doc_ethcc.vibecallin.com/agent-context
						</a>
						{" · "}
						<a
							href="https://doc_ethcc.vibecallin.com/agent-context.json"
							className="text-accent hover:underline"
							target="_blank"
							rel="noopener noreferrer"
						>
							agent-context.json
						</a>
					</p>
				</Section>

				{/* 1. Credential File */}
				<Section id="credential-file" title="1. Credential File">
					<p className="body-2 text-muted">
						You need a JSON credential file with this shape. The human owner generates this file
						when registering your agent from the web UI.
					</p>
					<CodeBlock language="json" title="agent-credential.json">
						{`{
  "version": 1,
  "label": "My Agent",
  "trustchainId": "0x<owner-wallet-address>",
  "privateKey": "0x<hex-encoded-secp256k1-private-key>",
  "publicKey": "0x<hex-encoded-compressed-public-key>",
  "createdAt": "2026-01-01T00:00:00.000Z"
}`}
					</CodeBlock>
					<div className="p-16 rounded-md bg-warning/10 border border-warning/20">
						<p className="body-2 text-base">
							<strong>Security:</strong> Never commit this file to version control. Add it to{" "}
							<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">.gitignore</code> and
							restrict file permissions (
							<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">chmod 600</code>).
							The <code className="px-4 py-2 rounded-xs bg-muted text-base body-3">privateKey</code>{" "}
							field is a secret — treat it like a password.
						</p>
					</div>
				</Section>

				{/* 2. AgentAuth Header */}
				<Section id="agentauth-header" title="2. Build the AgentAuth Header">
					<p className="body-2 text-muted">
						Every request to the API requires an{" "}
						<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">Authorization</code>{" "}
						header:
					</p>
					<CodeBlock language="text" title="Header format">
						{"Authorization: AgentAuth <timestamp>.<bodyHash>.<signature>"}
					</CodeBlock>

					<div className="overflow-x-auto">
						<table className="w-full border-collapse">
							<thead>
								<tr className="border-b border-muted">
									<th className="text-left body-3-semi-bold text-muted-subtle py-8 pr-16">Part</th>
									<th className="text-left body-3-semi-bold text-muted-subtle py-8">
										How to compute
									</th>
								</tr>
							</thead>
							<tbody className="body-2 text-muted">
								<tr className="border-b border-muted/50">
									<td className="py-8 pr-16">
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
											timestamp
										</code>
									</td>
									<td className="py-8">
										Current Unix epoch in <strong>seconds</strong> as a string (must be within 5 min
										of server time)
									</td>
								</tr>
								<tr className="border-b border-muted/50">
									<td className="py-8 pr-16">
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">bodyHash</code>
									</td>
									<td className="py-8">
										<strong>viem</strong>{" "}
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
											keccak256(toHex(rawBody))
										</code>{" "}
										— same as the API. For GET requests (no body), use the literal string{" "}
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">0x</code>.{" "}
										<strong>Do not use</strong>{" "}
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">cast keccak</code>{" "}
										— it does not match the server.
									</td>
								</tr>
								<tr className="border-b border-muted/50">
									<td className="py-8 pr-16">
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
											signature
										</code>
									</td>
									<td className="py-8">
										EIP-191{" "}
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
											personal_sign
										</code>{" "}
										of{" "}
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
											{"<timestamp>.<bodyHash>"}
										</code>{" "}
										with the agent private key (
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">0x</code>
										prefix). Use the Node helper below or sign in code (viem, ethers).
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<div className="p-16 rounded-md bg-accent/10">
						<p className="body-2 text-base">
							<strong>Important:</strong> All hex values (
							<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">bodyHash</code>,{" "}
							<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">signature</code>){" "}
							<strong>must</strong> include the{" "}
							<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">0x</code> prefix.
							Omitting it will result in a{" "}
							<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
								401 Authentication failed
							</code>{" "}
							error.
						</p>
					</div>

					<h3 className="heading-5-semi-bold text-base mt-24">Body hashing</h3>
					<p className="body-2 text-muted">
						The <code className="px-4 py-2 rounded-xs bg-muted text-base body-3">bodyHash</code> is
						computed over the <strong>exact bytes</strong> sent in the request body. Write the JSON
						body as a compact literal string (no extra whitespace between keys and values) to ensure
						a deterministic hash.
					</p>
					<h3 className="heading-5-semi-bold text-base mt-24">Shell helper (matches production)</h3>
					<p className="body-2 text-muted">
						From the repository root (after <code className="px-4 py-2 rounded-xs bg-muted text-base body-3">pnpm install</code>
						):
					</p>
					<CodeBlock language="bash" title="agent-auth-header.mjs">
						{`AUTH=$(node apps/web/scripts/agent-auth-header.mjs post "$BODY" "$CREDENTIAL_FILE")
# GET / poll:
AUTH=$(node apps/web/scripts/agent-auth-header.mjs get "$CREDENTIAL_FILE")
curl ... -H "Authorization: $AUTH"`}
					</CodeBlock>
				</Section>

			{/* 3. Send a Transfer Intent */}
			<Section id="send-intent" title="3. Send a Transfer Intent">
					<p className="body-2 text-muted">
						<strong>
							<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
								POST https://www.agentintents.io/api/intents
							</code>
						</strong>
					</p>

					<h3 className="heading-5-semi-bold text-base">Request body</h3>
					<CodeBlock language="json" title="Compact JSON body">
						{
							'{"agentId":"my-agent","agentName":"My Agent","details":{"type":"transfer","token":"USDC","amount":"1.00","recipient":"0xRecipientAddress","chainId":8453,"memo":"Reason for payment"},"urgency":"normal","expiresInMinutes":60}'
						}
					</CodeBlock>

					<h3 className="heading-5-semi-bold text-base">Response (201 Created)</h3>
					<CodeBlock language="json" title="Response">
						{`{
  "success": true,
  "intent": {
    "id": "int_1770399036079_804497de",
    "userId": "0x20bfb083c5adacc91c46ac4d37905d0447968166",
    "agentId": "my-agent",
    "agentName": "My Agent",
    "details": { "..." : "..." },
    "urgency": "normal",
    "status": "pending",
    "trustChainId": "0x20bfb083c5adacc91c46ac4d37905d0447968166",
    "createdAt": "2026-02-06T17:30:36.127Z",
    "expiresAt": "2026-02-06T18:30:36.080Z",
    "statusHistory": [
      { "status": "pending", "timestamp": "2026-02-06T17:30:36.222Z" }
    ]
  },
  "paymentUrl": "https://www.agentintents.io/pay/int_1770399036079_804497de"
}`}
					</CodeBlock>

					<p className="body-2 text-muted">
						Share the{" "}
						<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">paymentUrl</code> with
						the human so they can review and sign the transaction.
					</p>
				</Section>

				{/* 4. Poll for Completion */}
				<Section id="poll" title="4. Poll for Completion">
					<p className="body-2 text-muted">
						<strong>
							<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
								{"GET https://www.agentintents.io/api/intents/<intent-id>"}
							</code>
						</strong>
					</p>
					<p className="body-2 text-muted">
						Poll until{" "}
						<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">status</code> is one of
						the terminal states:{" "}
						<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">authorized</code> (Polymarket order signed),{" "}
						<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">confirmed</code>,{" "}
						<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">rejected</code>,{" "}
						<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">failed</code>, or{" "}
						<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">expired</code>.
					</p>
				</Section>

			{/* 5. Polymarket: Search Markets */}
			<Section id="search-markets" title="5. Polymarket: Search Markets">
				<p className="body-2 text-muted">
					<strong>
						<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
							{"GET https://www.agentintents.io/api/polymarket/markets?q=<search>&limit=<n>"}
						</code>
					</strong>
				</p>
				<p className="body-2 text-muted">
					No authentication required. Use this endpoint to find Polymarket markets by keyword
					before creating a trade intent.
				</p>

				<h3 className="heading-5-semi-bold text-base">Parameters</h3>
				<div className="overflow-x-auto">
					<table className="w-full border-collapse">
						<thead>
							<tr className="border-b border-muted">
								<th className="text-left body-3-semi-bold text-muted-subtle py-8 pr-16">Parameter</th>
								<th className="text-left body-3-semi-bold text-muted-subtle py-8 pr-16">Type</th>
								<th className="text-left body-3-semi-bold text-muted-subtle py-8 pr-16">Default</th>
								<th className="text-left body-3-semi-bold text-muted-subtle py-8">Description</th>
							</tr>
						</thead>
						<tbody className="body-2 text-muted">
							<tr className="border-b border-muted/50">
								<td className="py-8 pr-16">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">q</code>
								</td>
								<td className="py-8 pr-16">string</td>
								<td className="py-8 pr-16">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">{`""`}</code>
								</td>
								<td className="py-8">
									Search keyword (e.g. "bitcoin", "trump", "ethereum")
								</td>
							</tr>
							<tr className="border-b border-muted/50">
								<td className="py-8 pr-16">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">limit</code>
								</td>
								<td className="py-8 pr-16">number</td>
								<td className="py-8 pr-16">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">10</code>
								</td>
								<td className="py-8">Max results (1–50)</td>
							</tr>
						</tbody>
					</table>
				</div>

				<h3 className="heading-5-semi-bold text-base">Example request</h3>
				<CodeBlock language="bash" title="Search markets">
					{`curl -s "https://www.agentintents.io/api/polymarket/markets?q=bitcoin&limit=5" | jq .`}
				</CodeBlock>

				<h3 className="heading-5-semi-bold text-base">Response</h3>
				<CodeBlock language="json" title="Response">
					{`{
  "success": true,
  "markets": [
    {
      "conditionId": "0xabc123...",
      "question": "Will Bitcoin hit $100k by July 2026?",
      "yesPrice": 0.65,
      "noPrice": 0.35,
      "volume": 1250000,
      "endDate": "2026-07-01T00:00:00.000Z",
      "active": true
    }
  ]
}`}
				</CodeBlock>

				<p className="body-2 text-muted">
					Use the{" "}
					<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">conditionId</code> from
					the search result to create a Polymarket trade intent.
				</p>
			</Section>

			{/* 6. Polymarket: Create a Trade Intent */}
			<Section id="polymarket-trade" title="6. Polymarket: Create a Trade Intent">
				<p className="body-2 text-muted">
					<strong>
						<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
							POST https://www.agentintents.io/api/intents
						</code>
					</strong>
				</p>

				<h3 className="heading-5-semi-bold text-base">Request body</h3>
				<CodeBlock language="json" title="Compact JSON body">
					{
						'{"agentId":"my-agent","agentName":"My Agent","details":{"type":"polymarket_trade","conditionId":"0xabc123...","outcome":"Yes","amount":"50","chainId":137,"memo":"I believe this outcome is likely based on current analysis"},"urgency":"normal","expiresInMinutes":60}'
					}
				</CodeBlock>

				<h3 className="heading-5-semi-bold text-base">Fields</h3>
				<div className="overflow-x-auto">
					<table className="w-full border-collapse">
						<thead>
							<tr className="border-b border-muted">
								<th className="text-left body-3-semi-bold text-muted-subtle py-8 pr-16">Field</th>
								<th className="text-left body-3-semi-bold text-muted-subtle py-8 pr-16">Type</th>
								<th className="text-left body-3-semi-bold text-muted-subtle py-8 pr-16">Required</th>
								<th className="text-left body-3-semi-bold text-muted-subtle py-8">Description</th>
							</tr>
						</thead>
						<tbody className="body-2 text-muted">
							<tr className="border-b border-muted/50">
								<td className="py-8 pr-16">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">type</code>
								</td>
								<td className="py-8 pr-16">string</td>
								<td className="py-8 pr-16">Yes</td>
								<td className="py-8">
									Must be{" "}
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
										"polymarket_trade"
									</code>
								</td>
							</tr>
							<tr className="border-b border-muted/50">
								<td className="py-8 pr-16">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
										conditionId
									</code>
								</td>
								<td className="py-8 pr-16">string</td>
								<td className="py-8 pr-16">Yes</td>
								<td className="py-8">Polymarket condition ID (from search endpoint)</td>
							</tr>
							<tr className="border-b border-muted/50">
								<td className="py-8 pr-16">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">outcome</code>
								</td>
								<td className="py-8 pr-16">string</td>
								<td className="py-8 pr-16">Yes</td>
								<td className="py-8">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">"Yes"</code> or{" "}
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">"No"</code>
								</td>
							</tr>
							<tr className="border-b border-muted/50">
								<td className="py-8 pr-16">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">amount</code>
								</td>
								<td className="py-8 pr-16">string</td>
								<td className="py-8 pr-16">Yes</td>
								<td className="py-8">Amount in USDC (e.g. "50", "100.50")</td>
							</tr>
							<tr className="border-b border-muted/50">
								<td className="py-8 pr-16">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">chainId</code>
								</td>
								<td className="py-8 pr-16">number</td>
								<td className="py-8 pr-16">Yes</td>
								<td className="py-8">
									Must be{" "}
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">137</code>{" "}
									(Polygon)
								</td>
							</tr>
							<tr className="border-b border-muted/50">
								<td className="py-8 pr-16">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">memo</code>
								</td>
								<td className="py-8 pr-16">string</td>
								<td className="py-8 pr-16">No</td>
								<td className="py-8">
									Agent's justification for the trade (shown to the human)
								</td>
							</tr>
						</tbody>
					</table>
				</div>

				<p className="body-2 text-muted">
					The backend automatically enriches the intent with the market title (
					<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">marketTitle</code>),
					current outcome price (
					<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">outcomePrice</code>),
					and CLOB token ID (
					<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">tokenId</code>)
					from the Polymarket CLOB API.
				</p>

				<p className="body-2 text-muted">
					Response has the same structure as a transfer intent — includes{" "}
					<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">paymentUrl</code> for
					the human to review and sign.
				</p>
			</Section>

			{/* Complete Example: Transfer */}
			<Section id="complete-example" title="Complete Example: Transfer">
					<CodeBlock language="bash" title="create-intent.sh">
						{`#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────
CREDENTIAL_FILE="agent-credential.json"
AGENT_LABEL=$(jq -r '.label' "$CREDENTIAL_FILE")

# ── 1. Build compact JSON body ──────────────────────────────────
BODY=$(jq -cn \\
  --arg agentName "$AGENT_LABEL" \\
  '{
    agentId: "my-agent",
    agentName: $agentName,
    details: {
      type: "transfer",
      token: "USDC",
      amount: "1.00",
      recipient: "0xRecipientAddress",
      chainId: 8453,
      memo: "Reason for payment"
    },
    urgency: "normal",
    expiresInMinutes: 60
  }')

# ── 2. Auth header (viem-compatible — do not use cast keccak) ──
AUTH=$(node apps/web/scripts/agent-auth-header.mjs post "$BODY" "$CREDENTIAL_FILE")

# ── 3. Send intent ──────────────────────────────────────────────
RESPONSE=$(curl -s -X POST "https://www.agentintents.io/api/intents" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: $AUTH" \\
  -d "$BODY")

echo "$RESPONSE" | jq .

PAYMENT_URL=$(echo "$RESPONSE" | jq -r '.paymentUrl')
echo ""
echo "Share this link with the human: $PAYMENT_URL"

# ── 4. Poll for completion ──────────────────────────────────────
INTENT_ID=$(echo "$RESPONSE" | jq -r '.intent.id')
STATUS="pending"

for i in $(seq 1 120); do
  case "$STATUS" in confirmed|rejected|failed|expired) break ;; esac
  sleep 30
  POLL_AUTH=$(node apps/web/scripts/agent-auth-header.mjs get "$CREDENTIAL_FILE")
  STATUS=$(curl -s "https://www.agentintents.io/api/intents/\${INTENT_ID}" \\
    -H "Authorization: $POLL_AUTH" \\
    | jq -r '.intent.status')
  echo "Poll $i: status=$STATUS"
done

echo "Final status: $STATUS"`}
					</CodeBlock>
				</Section>

			{/* Complete Example: Polymarket Trade */}
			<Section id="polymarket-example" title="Complete Example: Polymarket Trade">
				<CodeBlock language="bash" title="polymarket-trade.sh">
					{`#!/usr/bin/env bash
set -euo pipefail

CREDENTIAL_FILE="agent-credential.json"
AGENT_LABEL=$(jq -r '.label' "$CREDENTIAL_FILE")
BASE_URL="https://www.agentintents.io"

# ── 1. Search for a market ──────────────────────────────────────
echo "Searching for markets..."
MARKETS=$(curl -s "\${BASE_URL}/api/polymarket/markets?q=bitcoin&limit=5")
# If the response is HTML (SPA), use Gamma instead, e.g.:
# curl -sS "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=20&order=volume&ascending=false"
echo "$MARKETS" | jq '.markets[]? | {conditionId, question, yesPrice, noPrice}'

CONDITION_ID=$(echo "$MARKETS" | jq -r '.markets[0].conditionId')
echo "Selected conditionId: $CONDITION_ID"

# ── 2. Build the polymarket_trade intent body ───────────────────
BODY=$(jq -cn \\
  --arg agentName "$AGENT_LABEL" \\
  --arg conditionId "$CONDITION_ID" \\
  '{
    agentId: "my-agent",
    agentName: $agentName,
    details: {
      type: "polymarket_trade",
      conditionId: $conditionId,
      outcome: "Yes",
      amount: "50",
      chainId: 137,
      memo: "Based on current market analysis"
    },
    urgency: "normal",
    expiresInMinutes: 60
  }')

# ── 3. Auth header (viem-compatible) ───────────────────────────
AUTH=$(node apps/web/scripts/agent-auth-header.mjs post "$BODY" "$CREDENTIAL_FILE")

# ── 4. Send intent ──────────────────────────────────────────────
RESPONSE=$(curl -s -X POST "\${BASE_URL}/api/intents" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: $AUTH" \\
  -d "$BODY")

echo "$RESPONSE" | jq .

PAYMENT_URL=$(echo "$RESPONSE" | jq -r '.paymentUrl')
echo ""
echo "Share this link with the human to review and sign: $PAYMENT_URL"

# ── 5. Poll for completion ──────────────────────────────────────
INTENT_ID=$(echo "$RESPONSE" | jq -r '.intent.id')
STATUS="pending"

for i in $(seq 1 120); do
  case "$STATUS" in authorized|confirmed|rejected|failed|expired) break ;; esac
  sleep 30
  POLL_AUTH=$(node apps/web/scripts/agent-auth-header.mjs get "$CREDENTIAL_FILE")
  STATUS=$(curl -s "\${BASE_URL}/api/intents/\${INTENT_ID}" \\
    -H "Authorization: $POLL_AUTH" \\
    | jq -r '.intent.status')
  echo "Poll $i: status=$STATUS"
done

echo "Final status: $STATUS"`}
				</CodeBlock>
			</Section>

			{/* Supported Chains */}
			<Section id="supported-chains" title="Supported Chains">
					<div className="overflow-x-auto">
						<table className="w-full border-collapse">
							<thead>
								<tr className="border-b border-muted">
									<th className="text-left body-3-semi-bold text-muted-subtle py-8 pr-16">
										Chain ID
									</th>
									<th className="text-left body-3-semi-bold text-muted-subtle py-8 pr-16">Name</th>
									<th className="text-left body-3-semi-bold text-muted-subtle py-8 pr-16">Token</th>
									<th className="text-left body-3-semi-bold text-muted-subtle py-8">Notes</th>
								</tr>
							</thead>
							<tbody className="body-2 text-muted">
								<tr className="border-b border-muted/50">
									<td className="py-8 pr-16">
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">8453</code>
									</td>
									<td className="py-8 pr-16">Base</td>
									<td className="py-8 pr-16">USDC</td>
									<td className="py-8">Mainnet</td>
								</tr>
								<tr className="border-b border-muted/50">
									<td className="py-8 pr-16">
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">84532</code>
									</td>
									<td className="py-8 pr-16">Base Sepolia</td>
									<td className="py-8 pr-16">USDC</td>
									<td className="py-8">Testnet</td>
								</tr>
							<tr className="border-b border-muted/50">
								<td className="py-8 pr-16">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">11155111</code>
								</td>
								<td className="py-8 pr-16">Sepolia</td>
								<td className="py-8 pr-16">USDC</td>
								<td className="py-8">Testnet</td>
							</tr>
							<tr className="border-b border-muted/50">
								<td className="py-8 pr-16">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">137</code>
								</td>
								<td className="py-8 pr-16">Polygon</td>
								<td className="py-8 pr-16">USDC</td>
								<td className="py-8">Polymarket trades only</td>
							</tr>
						</tbody>
					</table>
				</div>
			</Section>

			{/* Troubleshooting */}
				<Section id="troubleshooting" title="Troubleshooting">
					<div className="overflow-x-auto">
						<table className="w-full border-collapse">
							<thead>
								<tr className="border-b border-muted">
									<th className="text-left body-3-semi-bold text-muted-subtle py-8 pr-16">Error</th>
									<th className="text-left body-3-semi-bold text-muted-subtle py-8 pr-16">Cause</th>
									<th className="text-left body-3-semi-bold text-muted-subtle py-8">Fix</th>
								</tr>
							</thead>
							<tbody className="body-2 text-muted">
								<tr className="border-b border-muted/50">
									<td className="py-8 pr-16">
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
											401 Authentication failed
										</code>
									</td>
									<td className="py-8 pr-16">Used cast keccak or wrong body hash</td>
									<td className="py-8">
										Use viem{" "}
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
											keccak256(toHex(body))
										</code>{" "}
										or{" "}
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
											apps/web/scripts/agent-auth-header.mjs
										</code>
									</td>
								</tr>
								<tr className="border-b border-muted/50">
									<td className="py-8 pr-16">
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
											401 Authentication failed
										</code>
									</td>
									<td className="py-8 pr-16">Signature or body hash is malformed</td>
									<td className="py-8">
										Ensure{" "}
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">bodyHash</code>{" "}
										and{" "}
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
											signature
										</code>{" "}
										are <code className="px-4 py-2 rounded-xs bg-muted text-base body-3">0x</code>
										-prefixed hex strings
									</td>
								</tr>
								<tr className="border-b border-muted/50">
									<td className="py-8 pr-16">
										<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
											401 Authentication failed
										</code>
									</td>
									<td className="py-8 pr-16">Timestamp drift</td>
									<td className="py-8">
										Ensure your system clock is accurate (within 5 minutes of server time)
									</td>
								</tr>
							<tr className="border-b border-muted/50">
								<td className="py-8 pr-16">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
										401 Authentication failed
									</code>
								</td>
								<td className="py-8 pr-16">Body hash mismatch</td>
								<td className="py-8">
									Hash the <strong>exact</strong> request bytes (compact JSON, no trailing newline)
									with viem — not <code className="px-4 py-2 rounded-xs bg-muted text-base body-3">cast keccak</code>
								</td>
							</tr>
							<tr className="border-b border-muted/50">
								<td className="py-8 pr-16">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
										400 Market not found
									</code>
								</td>
								<td className="py-8 pr-16">
									Invalid{" "}
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
										conditionId
									</code>
								</td>
								<td className="py-8">
									Use the search endpoint (
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
										GET /api/polymarket/markets?q=...
									</code>
									) to find valid condition IDs
								</td>
							</tr>
							<tr className="border-b border-muted/50">
								<td className="py-8 pr-16">
									<code className="px-4 py-2 rounded-xs bg-muted text-base body-3">
										400 Market is no longer active
									</code>
								</td>
								<td className="py-8 pr-16">Market has closed or expired</td>
								<td className="py-8">Search for a different active market</td>
							</tr>
						</tbody>
						</table>
					</div>
				</Section>

				{/* Footer */}
				<div className="pt-32 border-t border-[#30363d]">
					<div className="flex items-center justify-between">
						<div>
							<p className="body-2 text-muted-subtle">
								Polyledger — Context for Agents
							</p>
							<p className="body-3 text-muted-subtle mt-4">
								Full API reference:{" "}
								<Link to="/docs" className="text-accent hover:underline">
									/docs
								</Link>
								{" | "}
								This page as Markdown:{" "}
								<a href="/agent-context.md" className="text-accent hover:underline">
									/agent-context.md
								</a>
								{" | "}
								This page as JSON:{" "}
								<a href="/agent-context.json" className="text-accent hover:underline">
									/agent-context.json
								</a>
							</p>
						</div>
						<Link
							to="/"
							className="px-16 py-8 rounded-md bg-accent text-on-accent body-2-semi-bold hover:bg-accent-hover transition-colors"
						>
							View Intent Queue →
						</Link>
					</div>
				</div>
			</main>
		</div>
	);
}

// =============================================================================
// NavLink Component (sidebar)
// =============================================================================

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
	return (
		<a
			href={href}
			className="block body-2 text-muted hover:text-base py-4 px-12 rounded-sm hover:bg-muted-transparent transition-colors"
		>
			{children}
		</a>
	);
}
