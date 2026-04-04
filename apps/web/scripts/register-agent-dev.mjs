#!/usr/bin/env node
/**
 * Dev-only: register an agent credential directly in the DB.
 *
 * This bypasses the Ledger-signature requirement and is intended for local
 * dev / CI only. Do NOT use in production.
 *
 * Usage:
 *   node apps/web/scripts/register-agent-dev.mjs [credential.json]
 *
 * What it does:
 *   1. Reads the credential file
 *   2. Derives the true Ethereum signer address from privateKey
 *   3. Patches the credential file so publicKey == signer address (consistent)
 *   4. Upserts the agent into trustchain_members
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { randomUUID } from "node:crypto";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, "..");

// ── Load .env ────────────────────────────────────────────────────────────────
function loadDotEnv() {
  const envPath = resolve(webRoot, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadDotEnv();

const pgUrl = process.env.POSTGRES_URL;
if (!pgUrl) {
  console.error("❌ POSTGRES_URL not set");
  process.exit(1);
}

const credPath = resolve(
  process.argv[2] || resolve(webRoot, "..", "..", "agent-credential.json")
);
if (!existsSync(credPath)) {
  console.error(`❌ Credential file not found: ${credPath}`);
  process.exit(1);
}

const cred = JSON.parse(readFileSync(credPath, "utf8"));
console.log(`\nCredential: ${credPath}`);
console.log(`  label:       ${cred.label}`);
console.log(`  trustchainId:${cred.trustchainId}`);
console.log(`  privateKey:  ${cred.privateKey.slice(0, 10)}…`);
console.log(`  publicKey:   ${cred.publicKey} (in file)`);

// Derive the true signer address from the private key
const account = privateKeyToAccount(cred.privateKey);
const signerAddress = account.address.toLowerCase();
console.log(`  signerAddr:  ${signerAddress} (derived from privateKey)`);

if (cred.publicKey.toLowerCase() !== signerAddress) {
  console.log(
    `\n⚠️  publicKey in credential file does not match signer address.`
  );
  console.log(`   Patching credential file: publicKey → ${signerAddress}`);
  cred.publicKey = signerAddress;
  writeFileSync(credPath, JSON.stringify(cred, null, 2) + "\n", "utf8");
  console.log(`   ✅ credential file updated.`);
}

// ── Connect to DB ────────────────────────────────────────────────────────────
const client = new pg.Client({
  connectionString: pgUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
console.log(`\n✅ Connected to Postgres`);

// Check if already registered
const existing = await client.query(
  "SELECT id, revoked_at FROM trustchain_members WHERE LOWER(member_pubkey) = $1 LIMIT 1",
  [signerAddress]
);

if (existing.rows.length > 0) {
  const row = existing.rows[0];
  if (row.revoked_at) {
    console.log(`\n⚠️  Agent exists but is REVOKED (id=${row.id}). Re-activating...`);
    await client.query(
      "UPDATE trustchain_members SET revoked_at = NULL WHERE id = $1",
      [row.id]
    );
    console.log(`✅ Agent re-activated.`);
  } else {
    console.log(`\n✅ Agent already registered and active (id=${row.id}). Nothing to do.`);
  }
  await client.end();
  process.exit(0);
}

// Insert new member
const id = randomUUID();
const trustchainId = cred.trustchainId.toLowerCase();
const label = cred.label || "dev-agent";

await client.query(
  `INSERT INTO trustchain_members (id, trustchain_id, member_pubkey, role, label)
   VALUES ($1, $2, $3, $4, $5)`,
  [id, trustchainId, signerAddress, "agent_write_only", label]
);

console.log(`\n✅ Agent registered!`);
console.log(`   id:          ${id}`);
console.log(`   trustchain:  ${trustchainId}`);
console.log(`   member_pubkey: ${signerAddress}`);
console.log(`   label:       ${label}`);

await client.end();
console.log(`\nDone. You can now run ./script.sh\n`);
