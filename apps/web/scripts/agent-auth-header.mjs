#!/usr/bin/env node
/**
 * Build AgentAuth header matching apps/web/api/_lib/agentAuth.ts (viem keccak256 + toHex + personal_sign).
 *
 * Usage:
 *   node agent-auth-header.mjs post '<compact-json-body>' <credential.json>
 *   node agent-auth-header.mjs get <credential.json>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

function loadCredential(path) {
	const abs = resolve(path);
	const cred = JSON.parse(readFileSync(abs, "utf8"));
	if (!cred?.privateKey) {
		throw new Error(`Invalid credential: ${abs}`);
	}
	return cred;
}

const [, , mode, ...rest] = process.argv;

if (mode === "post") {
	const body = rest[0];
	const credPath = rest[1];
	if (!body || !credPath) {
		console.error("Usage: node agent-auth-header.mjs post '<json-body>' <credential.json>");
		process.exit(1);
	}
	const cred = loadCredential(credPath);
	const account = privateKeyToAccount(cred.privateKey);
	const timestamp = Math.floor(Date.now() / 1000).toString();
	const bodyHash = keccak256(toHex(body));
	const message = `${timestamp}.${bodyHash}`;
	const signature = await account.signMessage({ message });
	process.stdout.write(`AgentAuth ${timestamp}.${bodyHash}.${signature}`);
} else if (mode === "get") {
	const credPath = rest[0];
	if (!credPath) {
		console.error("Usage: node agent-auth-header.mjs get <credential.json>");
		process.exit(1);
	}
	const cred = loadCredential(credPath);
	const account = privateKeyToAccount(cred.privateKey);
	const timestamp = Math.floor(Date.now() / 1000).toString();
	const message = `${timestamp}.0x`;
	const signature = await account.signMessage({ message });
	process.stdout.write(`AgentAuth ${timestamp}.0x.${signature}`);
} else {
	console.error("Modes: post | get");
	process.exit(1);
}
