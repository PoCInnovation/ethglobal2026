import pg from "pg";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(resolve(webRoot, ".env"), "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx < 0) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  if (!process.env[key]) process.env[key] = val;
}

const client = new pg.Client({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

// Simulate server context (what agentAuth.ts does via withDbRlsContext)
await client.query("SELECT set_config('app.role', 'system', false), set_config('app.current_user', '', false)");

const all = await client.query("SELECT id, member_pubkey, label, revoked_at FROM trustchain_members WHERE revoked_at IS NULL");
console.log("Rows visible under systemRole context:", all.rows.length);
for (const r of all.rows) console.log(" ", r.id, r.member_pubkey, r.label);

const signerAddr = "0x31ea8235e28badf1f9306a7e91d4e9d855832c4d";
const exact = await client.query(
  "SELECT id FROM trustchain_members WHERE LOWER(member_pubkey) = $1 AND revoked_at IS NULL LIMIT 1",
  [signerAddr]
);
console.log("\nExact match for signer addr:", exact.rows.length > 0 ? "FOUND ✅" : "NOT FOUND ❌");

await client.end();
