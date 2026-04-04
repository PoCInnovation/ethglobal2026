#!/usr/bin/env node
/**
 * Diagnostic script for agent authentication issues.
 *
 * Checks:
 *   1. Database connectivity (POSTGRES_URL)
 *   2. Agent registration in trustchain_members
 *   3. Body hash round-trip consistency (JSON.parse → JSON.stringify vs raw)
 *
 * Usage:
 *   node apps/web/scripts/diagnose-agent.mjs [credential.json]
 *
 * Requires POSTGRES_URL in environment (or .env in apps/web/).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toHex, isAddress } from "viem";
import { privateKeyToAccount, publicKeyToAddress } from "viem/accounts";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, "..");

// ── Load .env manually ──────────────────────────────────────────────────────
function loadDotEnv() {
  const envPath = resolve(webRoot, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadDotEnv();

// ── Helpers ──────────────────────────────────────────────────────────────────
const ok = (msg) => console.log(`  ✅ ${msg}`);
const fail = (msg) => console.log(`  ❌ ${msg}`);
const info = (msg) => console.log(`  ℹ️  ${msg}`);

// ── 1. Database connectivity ────────────────────────────────────────────────
console.log("\n━━━ 1. Database connectivity ━━━");

const pgUrl = process.env.POSTGRES_URL;
if (!pgUrl) {
  fail("POSTGRES_URL not set. Set it in apps/web/.env or as env var.");
  process.exit(1);
}
ok(`POSTGRES_URL is set (${pgUrl.replace(/\/\/.*@/, "//***@")})`);

let client;
try {
  client = new pg.Client({ connectionString: pgUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const res = await client.query("SELECT NOW() AS server_time");
  ok(`Connected to Postgres. Server time: ${res.rows[0].server_time}`);
} catch (err) {
  fail(`Cannot connect to Postgres: ${err.message}`);
  process.exit(1);
}

// Check tables exist
for (const table of ["auth_challenges", "auth_sessions", "trustchain_members", "intents"]) {
  try {
    const r = await client.query(`SELECT COUNT(*)::int AS cnt FROM ${table}`);
    ok(`Table "${table}" exists (${r.rows[0].cnt} rows)`);
  } catch (err) {
    fail(`Table "${table}" missing or inaccessible: ${err.message}`);
  }
}

// ── 2. Agent registration check ─────────────────────────────────────────────
console.log("\n━━━ 2. Agent registration in trustchain_members ━━━");

const credPath = resolve(process.argv[2] || resolve(webRoot, "..", "..", "agent-credential.json"));
if (!existsSync(credPath)) {
  fail(`Credential file not found: ${credPath}`);
  await client.end();
  process.exit(1);
}

const cred = JSON.parse(readFileSync(credPath, "utf8"));
info(`Credential file: ${credPath}`);
info(`Label: ${cred.label}`);
info(`TrustchainId: ${cred.trustchainId}`);
info(`PublicKey: ${cred.publicKey}`);

// Derive Ethereum address from private key (same as what AgentAuth recovers)
const account = privateKeyToAccount(cred.privateKey);
const signerAddress = account.address.toLowerCase();
info(`Signer Ethereum address (derived from privateKey): ${signerAddress}`);

// Derive Ethereum address from publicKey (same as what the server does from stored pubkey)
let derivedFromPubkey = null;
try {
  derivedFromPubkey = publicKeyToAddress(cred.publicKey).toLowerCase();
  info(`Ethereum address (derived from publicKey): ${derivedFromPubkey}`);
  if (signerAddress === derivedFromPubkey) {
    ok("privateKey and publicKey produce the SAME Ethereum address ✓");
  } else {
    fail(`MISMATCH! privateKey → ${signerAddress}, publicKey → ${derivedFromPubkey}`);
  }
} catch (err) {
  fail(`Cannot derive address from publicKey: ${err.message}`);
}

// Check DB for this agent
const pubkeyLower = cred.publicKey.toLowerCase();

// Exact pubkey match
const exactRes = await client.query(
  "SELECT id, trustchain_id, member_pubkey, role, label, revoked_at FROM trustchain_members WHERE LOWER(member_pubkey) = $1",
  [pubkeyLower]
);
if (exactRes.rows.length > 0) {
  const row = exactRes.rows[0];
  if (row.revoked_at) {
    fail(`Agent found but REVOKED (revoked_at: ${row.revoked_at})`);
  } else {
    ok(`Agent found by pubkey! id=${row.id}, label=${row.label}, role=${row.role}, trustchain=${row.trustchain_id}`);
  }
} else {
  fail(`No trustchain_member found with member_pubkey = ${pubkeyLower}`);
}

// Exact address match
const addrRes = await client.query(
  "SELECT id, trustchain_id, member_pubkey, role, label, revoked_at FROM trustchain_members WHERE LOWER(member_pubkey) = $1",
  [signerAddress]
);
if (addrRes.rows.length > 0) {
  ok(`Agent also found by signer address directly`);
}

// List ALL active members for context
const allRes = await client.query(
  "SELECT id, trustchain_id, member_pubkey, role, label, revoked_at FROM trustchain_members WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 20"
);
console.log(`\n  All active members (${allRes.rows.length}):`);
for (const row of allRes.rows) {
  let derivedAddr = "?";
  try {
    const p = row.member_pubkey.trim().toLowerCase();
    if (isAddress(p)) {
      derivedAddr = p;
    } else if (/^0x(02|03)[0-9a-f]{64}$/.test(p)) {
      derivedAddr = publicKeyToAddress(row.member_pubkey).toLowerCase();
    }
  } catch { /* ignore */ }
  console.log(`    - id=${row.id} label=${row.label} pubkey=${row.member_pubkey.slice(0, 20)}… → addr=${derivedAddr} trustchain=${row.trustchain_id}`);
}

// ── 3. Body hash round-trip test ────────────────────────────────────────────
console.log("\n━━━ 3. Body hash round-trip consistency ━━━");

const testBody = JSON.stringify({
  agentId: "manual-test-agent",
  agentName: cred.label,
  details: {
    type: "polymarket_trade",
    conditionId: "0x9c5f23552a5a52cdf755cb4bf075576ca95e89d578370066ebda4e67430187cd",
    outcome: "Yes",
    amount: "10",
    chainId: 137,
    memo: "script2.sh \u2014 test manuel pipeline Polymarket",
  },
  urgency: "normal",
  expiresInMinutes: 60,
});

// Simulate what the script does: hash the raw body string
const scriptHash = keccak256(toHex(testBody));
info(`Script-side body hash: ${scriptHash}`);

// Simulate what Vercel does: parse JSON → re-stringify → hash
const parsed = JSON.parse(testBody);
const reStringified = JSON.stringify(parsed);
const serverHash = keccak256(toHex(reStringified));
info(`Server-side body hash (parse→stringify): ${serverHash}`);

if (scriptHash === serverHash) {
  ok("Body hashes MATCH ✓ — round-trip is consistent");
} else {
  fail("Body hashes MISMATCH — this causes the 401!");
  info(`Raw body length: ${testBody.length}, re-stringified length: ${reStringified.length}`);
  // Find first difference
  for (let i = 0; i < Math.max(testBody.length, reStringified.length); i++) {
    if (testBody[i] !== reStringified[i]) {
      info(`First difference at index ${i}: script='${testBody.slice(i, i + 20)}' server='${reStringified.slice(i, i + 20)}'`);
      break;
    }
  }
}

// Also test: what if Vercel receives the body and the jq output differs?
// The script uses jq -cn which might produce slightly different output
const jqStyleBody = `{"agentId":"manual-test-agent","agentName":"${cred.label}","details":{"type":"polymarket_trade","conditionId":"0x9c5f23552a5a52cdf755cb4bf075576ca95e89d578370066ebda4e67430187cd","outcome":"Yes","amount":"10","chainId":137,"memo":"script2.sh — test manuel pipeline Polymarket"},"urgency":"normal","expiresInMinutes":60}`;
const jqHash = keccak256(toHex(jqStyleBody));
const jqParsedHash = keccak256(toHex(JSON.stringify(JSON.parse(jqStyleBody))));

info(`\njq raw body hash:    ${jqHash}`);
info(`jq round-trip hash:  ${jqParsedHash}`);
if (jqHash === jqParsedHash) {
  ok("jq body also round-trips consistently ✓");
} else {
  fail("jq body round-trip MISMATCH!");
  info(`jq raw:    ${jqStyleBody.length} chars`);
  info(`jq re-str: ${JSON.stringify(JSON.parse(jqStyleBody)).length} chars`);
  for (let i = 0; i < Math.max(jqStyleBody.length, JSON.stringify(JSON.parse(jqStyleBody)).length); i++) {
    if (jqStyleBody[i] !== JSON.stringify(JSON.parse(jqStyleBody))[i]) {
      info(`First diff at index ${i}: jq='${jqStyleBody.slice(i, i + 30)}' roundtrip='${JSON.stringify(JSON.parse(jqStyleBody)).slice(i, i + 30)}'`);
      break;
    }
  }
}

// ── Done ────────────────────────────────────────────────────────────────────
console.log("\n━━━ Done ━━━\n");
await client.end();
