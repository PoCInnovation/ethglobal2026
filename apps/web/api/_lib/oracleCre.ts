/**
 * Oracle CRE abstraction layer.
 *
 * Currently delegates to the Gamma API (polymarketService) as a fallback
 * until the Chainlink CRE oracle contract is deployed on Polygon.
 *
 * When the oracle is live, this module will read on-chain data via viem
 * and compare with the Gamma API for verification.
 */

import type { PolymarketTradeDetails } from "@agent-intents/shared";
import { POLYMARKET_CONFIG } from "@agent-intents/shared";
import { enrichPolymarketIntent as enrichViaGamma } from "./polymarketService.js";
import { logger } from "./logger.js";

function getOracleCREAddress(): `0x${string}` {
	const envAddr = process.env.ORACLE_CRE_ADDRESS;
	return (envAddr?.startsWith("0x") ? envAddr : POLYMARKET_CONFIG.ORACLE_CRE_ADDRESS) as `0x${string}`;
}

/**
 * Verify and enrich a Polymarket trade intent using the best available
 * data source (Oracle CRE when available, Gamma API as fallback).
 */
export async function verifyAndEnrichPolymarketIntent(
	details: PolymarketTradeDetails,
): Promise<PolymarketTradeDetails> {
	const oracleAddress = getOracleCREAddress();
	const isOracleDeployed =
		oracleAddress !== "0x0000000000000000000000000000000000000000";

	if (isOracleDeployed) {
		// TODO: When Oracle CRE is deployed, read on-chain data here:
		//   const oracleData = await readOracleContract(details.conditionId);
		//   if (oracleData) return { ...details, marketTitle: oracleData.question, outcomePrice: ... };
		logger.info({ conditionId: details.conditionId, oracleAddress }, "Oracle CRE configured but read not yet implemented, falling back to Gamma");
	} else {
		logger.debug({ conditionId: details.conditionId }, "Oracle CRE not configured (0x0), using Gamma API fallback");
	}
	return enrichViaGamma(details);
}
