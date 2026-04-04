/**
 * Polymarket token allowance management.
 *
 * Before trading, the user's wallet must approve USDC.e spending
 * by the CTF Exchange and Neg Risk contracts on Polygon.
 */

import { useCallback, useEffect, useState } from "react";
import { useLedger } from "./ledger-provider";
import {
	createPublicClient,
	encodeFunctionData,
	http,
	type Address,
	parseAbi,
	maxUint256,
} from "viem";
import { polygon } from "viem/chains";

// Polygon contract addresses
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as Address;
const CTF_TOKEN = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as Address;

// Only the CTF Exchange is needed for standard (non-neg-risk) markets
const SPENDERS = {
	CTF_EXCHANGE: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" as Address,
} as const;

const ERC20_ABI = parseAbi([
	"function allowance(address owner, address spender) view returns (uint256)",
	"function approve(address spender, uint256 amount) returns (bool)",
]);

const ERC1155_ABI = parseAbi([
	"function isApprovedForAll(address account, address operator) view returns (bool)",
	"function setApprovalForAll(address operator, bool approved)",
]);

// Minimum allowance threshold — if below this, prompt approval
const MIN_ALLOWANCE = BigInt("1000000000000"); // 1M USDC.e (way more than needed)

const client = createPublicClient({
	chain: polygon,
	transport: http("https://polygon.drpc.org"),
});

export interface AllowanceStatus {
	usdcApproved: boolean; // All 3 spenders approved for USDC.e
	ctfApproved: boolean; // All 3 operators approved for CTF (ERC-1155)
	loading: boolean;
	error: string | null;
}

async function checkUsdcAllowances(owner: Address): Promise<boolean> {
	for (const spender of Object.values(SPENDERS)) {
		const allowance = await client.readContract({
			address: USDC_E,
			abi: ERC20_ABI,
			functionName: "allowance",
			args: [owner, spender],
		});
		if (allowance < MIN_ALLOWANCE) return false;
	}
	return true;
}

async function checkCtfAllowances(owner: Address): Promise<boolean> {
	for (const operator of Object.values(SPENDERS)) {
		const approved = await client.readContract({
			address: CTF_TOKEN,
			abi: ERC1155_ABI,
			functionName: "isApprovedForAll",
			args: [owner, operator],
		});
		if (!approved) return false;
	}
	return true;
}

export function usePolymarketAllowance() {
	const { account, sendTransaction } = useLedger();
	const [status, setStatus] = useState<AllowanceStatus>({
		usdcApproved: false,
		ctfApproved: false,
		loading: false,
		error: null,
	});
	const [isApproving, setIsApproving] = useState(false);

	// Check allowances on mount and account change
	useEffect(() => {
		if (!account) return;
		const owner = account as Address;

		setStatus((s) => ({ ...s, loading: true, error: null }));

		Promise.all([checkUsdcAllowances(owner), checkCtfAllowances(owner)])
			.then(([usdc, ctf]) => {
				setStatus({ usdcApproved: usdc, ctfApproved: ctf, loading: false, error: null });
			})
			.catch((err) => {
				setStatus((s) => ({
					...s,
					loading: false,
					error: err instanceof Error ? err.message : "Failed to check allowances",
				}));
			});
	}, [account]);

	/**
	 * Approve all required contracts. Sends up to 6 transactions:
	 * 3x USDC.e approve + 3x CTF setApprovalForAll
	 */
	const approveAll = useCallback(async () => {
		if (!account) throw new Error("No wallet connected");
		setIsApproving(true);
		setStatus((s) => ({ ...s, error: null }));

		try {
			const owner = account as Address;

			// USDC.e approvals
			for (const [name, spender] of Object.entries(SPENDERS)) {
				const allowance = await client.readContract({
					address: USDC_E,
					abi: ERC20_ABI,
					functionName: "allowance",
					args: [owner, spender],
				});
				if (allowance < MIN_ALLOWANCE) {
					console.log(`[Allowance] Approving USDC.e for ${name}...`);
					const data = encodeFunctionData({
						abi: ERC20_ABI,
						functionName: "approve",
						args: [spender, maxUint256],
					});
					const txHash = await sendTransaction({
						to: USDC_E,
						data,
						value: "0x0",
					});
					// Wait for confirmation before next tx (nonce must increment)
					await client.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
					console.log(`[Allowance] USDC.e approved for ${name} (tx: ${txHash})`);
				}
			}

			// CTF (ERC-1155) approvals
			for (const [name, operator] of Object.entries(SPENDERS)) {
				const approved = await client.readContract({
					address: CTF_TOKEN,
					abi: ERC1155_ABI,
					functionName: "isApprovedForAll",
					args: [owner, operator],
				});
				if (!approved) {
					console.log(`[Allowance] Approving CTF for ${name}...`);
					const data = encodeFunctionData({
						abi: ERC1155_ABI,
						functionName: "setApprovalForAll",
						args: [operator, true],
					});
					const txHash = await sendTransaction({
						to: CTF_TOKEN,
						data,
						value: "0x0",
					});
					await client.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
					console.log(`[Allowance] CTF approved for ${name} (tx: ${txHash})`);
				}
			}

			// Re-check
			const [usdc, ctf] = await Promise.all([
				checkUsdcAllowances(owner),
				checkCtfAllowances(owner),
			]);
			setStatus({ usdcApproved: usdc, ctfApproved: ctf, loading: false, error: null });
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Approval failed";
			setStatus((s) => ({ ...s, error: msg }));
			throw err;
		} finally {
			setIsApproving(false);
		}
	}, [account, sendTransaction]);

	const allApproved = status.usdcApproved && status.ctfApproved;

	return {
		...status,
		allApproved,
		isApproving,
		approveAll,
	};
}
