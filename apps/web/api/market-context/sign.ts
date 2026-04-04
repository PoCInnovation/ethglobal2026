import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSign } from "node:crypto";

// TLV tag constants (must match C device code)
const TAG = {
  STRUCT_TYPE: 0x01,
  STRUCT_VERSION: 0x02,
  CHAIN_ID: 0x23,
  TOKEN_ID: 0x60,
  ISSUED_AT: 0x61,
  EXPIRES_AT: 0x62,
  ATTESTER_ID: 0x63,
  MARKET_NAME: 0x64,
  MARKET_OUTCOME: 0x65,
  MARKET_AMOUNT: 0x66,
  MARKET_SHARES: 0x67,
  MARKET_PRICE: 0x68,
  AUTH_LABEL: 0x70,
  AUTH_ADDRESS: 0x71,
  DER_SIGNATURE: 0x15,
};

const MCP_STRUCT_TYPE = 0x0a;
const MCP_AUTH_STRUCT_TYPE = 0x0b;
const MCP_STRUCT_VERSION = 0x01;
const TTL_SECONDS = 300;

function tlvField(tag: number, value: Buffer): Buffer {
  const tagBuf = Buffer.alloc(1);
  tagBuf.writeUInt8(tag);
  const len = value.length;
  let lenBuf: Buffer;
  if (len < 0x80) {
    lenBuf = Buffer.alloc(1);
    lenBuf.writeUInt8(len);
  } else if (len <= 0xff) {
    lenBuf = Buffer.from([0x81, len]);
  } else {
    lenBuf = Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  }
  return Buffer.concat([tagBuf, lenBuf, value]);
}

function signAndAppend(payload: Buffer): Buffer | null {
  const privKeyPem = process.env.MCP_ATTESTER_PRIVATE_KEY_PEM;
  if (!privKeyPem) return null;
  const pemContent = privKeyPem.replace(/\|/g, "\n");
  const sign = createSign("SHA256");
  sign.update(payload);
  const sig = sign.sign(pemContent);
  return Buffer.concat([payload, tlvField(TAG.DER_SIGNATURE, sig)]);
}

function buildOrderPayload(body: Record<string, unknown>): Buffer {
  const { tokenId, chainId, marketName, marketOutcome, marketAmount, marketShares, marketPrice } = body;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TTL_SECONDS;

  const tokenIdBuf = Buffer.from(
    BigInt(tokenId as string).toString(16).padStart(64, "0"),
    "hex"
  );
  const chainIdBuf = Buffer.alloc(8);
  chainIdBuf.writeBigUInt64BE(BigInt(chainId as number));
  const issuedAtBuf = Buffer.alloc(4);
  issuedAtBuf.writeUInt32BE(now);
  const expiresAtBuf = Buffer.alloc(4);
  expiresAtBuf.writeUInt32BE(expiresAt);

  return Buffer.concat([
    tlvField(TAG.STRUCT_TYPE, Buffer.from([MCP_STRUCT_TYPE])),
    tlvField(TAG.STRUCT_VERSION, Buffer.from([MCP_STRUCT_VERSION])),
    tlvField(TAG.CHAIN_ID, chainIdBuf),
    tlvField(TAG.TOKEN_ID, tokenIdBuf),
    tlvField(TAG.ISSUED_AT, issuedAtBuf),
    tlvField(TAG.EXPIRES_AT, expiresAtBuf),
    tlvField(TAG.ATTESTER_ID, Buffer.from([0x00])),
    tlvField(TAG.MARKET_NAME, Buffer.from(String(marketName).slice(0, 128))),
    tlvField(TAG.MARKET_OUTCOME, Buffer.from(String(marketOutcome).slice(0, 16))),
    tlvField(TAG.MARKET_AMOUNT, Buffer.from(String(marketAmount).slice(0, 32))),
    tlvField(TAG.MARKET_SHARES, Buffer.from(String(marketShares).slice(0, 32))),
    tlvField(TAG.MARKET_PRICE, Buffer.from(String(marketPrice).slice(0, 32))),
  ]);
}

function buildAuthPayload(body: Record<string, unknown>): Buffer {
  const { chainId, label, address } = body;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TTL_SECONDS;

  const chainIdBuf = Buffer.alloc(8);
  chainIdBuf.writeBigUInt64BE(BigInt(chainId as number));
  const issuedAtBuf = Buffer.alloc(4);
  issuedAtBuf.writeUInt32BE(now);
  const expiresAtBuf = Buffer.alloc(4);
  expiresAtBuf.writeUInt32BE(expiresAt);

  return Buffer.concat([
    tlvField(TAG.STRUCT_TYPE, Buffer.from([MCP_AUTH_STRUCT_TYPE])),
    tlvField(TAG.STRUCT_VERSION, Buffer.from([MCP_STRUCT_VERSION])),
    tlvField(TAG.CHAIN_ID, chainIdBuf),
    tlvField(TAG.ISSUED_AT, issuedAtBuf),
    tlvField(TAG.EXPIRES_AT, expiresAtBuf),
    tlvField(TAG.AUTH_LABEL, Buffer.from(String(label).slice(0, 64))),
    tlvField(TAG.AUTH_ADDRESS, Buffer.from(String(address).slice(0, 42))),
  ]);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { type } = req.body;
  let payload: Buffer;

  if (type === "auth") {
    const { chainId, label, address } = req.body;
    if (!chainId || !label || !address) {
      return res.status(400).json({ error: "Missing required auth fields" });
    }
    payload = buildAuthPayload(req.body);
  } else {
    const { tokenId, chainId, marketName, marketOutcome, marketAmount, marketShares, marketPrice } =
      req.body;
    if (!tokenId || !chainId || !marketName || !marketOutcome || !marketAmount || !marketShares || !marketPrice) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    payload = buildOrderPayload(req.body);
  }

  const signed = signAndAppend(payload);
  if (!signed) {
    return res.status(500).json({ error: "Attester key not configured" });
  }

  return res.status(200).json({ payload: signed.toString("hex") });
}
