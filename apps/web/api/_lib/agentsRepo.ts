/**
 * Agents repository - database operations for trustchain members (agents).
 */
import type { TrustchainMember, TrustchainMemberRole } from "@agent-intents/shared";
import { secp256k1 } from "@noble/curves/secp256k1";
import { isAddress, type Hex } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { type DbExecutor, sql } from "./db.js";

interface TrustchainMemberRow {
	id: string;
	trustchain_id: string;
	member_pubkey: string;
	role: TrustchainMemberRole;
	label: string | null;
	authorization_signature: string | null;
	created_at: Date;
	revoked_at: Date | null;
}

function rowToMember(row: TrustchainMemberRow): TrustchainMember {
	return {
		id: row.id,
		trustchainId: row.trustchain_id,
		memberPubkey: row.member_pubkey,
		role: row.role,
		label: row.label,
		createdAt: row.created_at.toISOString(),
		revokedAt: row.revoked_at?.toISOString() ?? null,
	};
}

export async function registerAgent(
	params: {
		trustchainId: string;
		memberPubkey: string;
		role?: TrustchainMemberRole;
		label?: string;
		authorizationSignature?: string;
	},
	db: DbExecutor = sql,
): Promise<TrustchainMember> {
	const {
		trustchainId,
		memberPubkey,
		role = "agent_write_only",
		label,
		authorizationSignature,
	} = params;

	const result = await db`
    INSERT INTO trustchain_members (trustchain_id, member_pubkey, role, label, authorization_signature)
    VALUES (${trustchainId}, ${memberPubkey}, ${role}, ${label ?? null}, ${authorizationSignature ?? null})
    RETURNING *
  `;

	return rowToMember(result.rows[0] as TrustchainMemberRow);
}

export async function getActiveMemberByPubkey(
	pubkey: string,
	db: DbExecutor = sql,
): Promise<TrustchainMember | null> {
	const result = await db`
    SELECT * FROM trustchain_members
    WHERE member_pubkey = ${pubkey}
      AND revoked_at IS NULL
    LIMIT 1
  `;

	if (result.rows.length === 0) return null;
	return rowToMember(result.rows[0] as TrustchainMemberRow);
}

/**
 * Ethereum address derived from a stored `member_pubkey` value.
 * Registration stores compressed secp256k1 public keys (0x02 / 0x03…); AgentAuth
 * recovers the signer's Ethereum address from the request signature.
 */
function ethereumAddressFromStoredMemberPubkey(memberPubkey: string): string | null {
	const p = memberPubkey.trim();
	if (isAddress(p)) {
		return p.toLowerCase();
	}
	const lower = p.toLowerCase();
	if (!/^0x(02|03)[0-9a-f]{64}$/.test(lower)) {
		return null;
	}
	try {
		const uncompressedHex = secp256k1.ProjectivePoint.fromHex(lower.slice(2)).toHex(false);
		return publicKeyToAddress(`0x${uncompressedHex}` as Hex).toLowerCase();
	} catch {
		return null;
	}
}

/**
 * Resolve an active trustchain member from the AgentAuth signer's Ethereum address.
 * Handles rows where `member_pubkey` is either that address or a compressed secp256k1 key.
 */
export async function getActiveMemberByAgentSignerAddress(
	signerAddress: string,
	db: DbExecutor = sql,
): Promise<TrustchainMember | null> {
	const want = signerAddress.toLowerCase();

	const exact = await db`
    SELECT * FROM trustchain_members
    WHERE LOWER(member_pubkey) = ${want}
      AND revoked_at IS NULL
    LIMIT 1
  `;
	if (exact.rows.length > 0) {
		return rowToMember(exact.rows[0] as TrustchainMemberRow);
	}

	const all = await db`
    SELECT * FROM trustchain_members
    WHERE revoked_at IS NULL
  `;
	for (const row of all.rows as TrustchainMemberRow[]) {
		const derived = ethereumAddressFromStoredMemberPubkey(row.member_pubkey);
		if (derived === want) {
			return rowToMember(row);
		}
	}
	return null;
}

export async function getMemberById(
	id: string,
	db: DbExecutor = sql,
): Promise<TrustchainMember | null> {
	const result = await db`
    SELECT * FROM trustchain_members WHERE id = ${id}::uuid
    LIMIT 1
  `;

	if (result.rows.length === 0) return null;
	return rowToMember(result.rows[0] as TrustchainMemberRow);
}

export async function getMembersByTrustchain(
	trustchainId: string,
	db: DbExecutor = sql,
): Promise<TrustchainMember[]> {
	const result = await db`
    SELECT * FROM trustchain_members
    WHERE trustchain_id = ${trustchainId}
    ORDER BY created_at DESC
  `;

	return (result.rows as TrustchainMemberRow[]).map(rowToMember);
}

export async function revokeMember(
	id: string,
	db: DbExecutor = sql,
): Promise<TrustchainMember | null> {
	const result = await db`
    UPDATE trustchain_members
    SET revoked_at = NOW()
    WHERE id = ${id}::uuid AND revoked_at IS NULL
    RETURNING *
  `;

	if (result.rows.length === 0) return null;
	return rowToMember(result.rows[0] as TrustchainMemberRow);
}
