import { useState } from "react";
import { Button } from "@ledgerhq/lumen-ui-react";
import { Spinner } from "@/components/ui/Spinner";
import { useLedger } from "@/lib/ledger-provider";

/**
 * Hardcoded Polymarket order EIP-712 typed data for testing the full
 * MCP clear-signing flow on the device. The order is never submitted.
 */
function buildTestOrder(walletAddress: string) {
	return {
		domain: {
			name: "Polymarket CTF Exchange",
			version: "1",
			chainId: 137,
			verifyingContract: "0xC5d563A36AE78145C45a50134d48A1215220f80a", // negRisk exchange
		},
		primaryType: "Order" as const,
		types: {
			EIP712Domain: [
				{ name: "name", type: "string" },
				{ name: "version", type: "string" },
				{ name: "chainId", type: "uint256" },
				{ name: "verifyingContract", type: "address" },
			],
			Order: [
				{ name: "salt", type: "uint256" },
				{ name: "maker", type: "address" },
				{ name: "signer", type: "address" },
				{ name: "taker", type: "address" },
				{ name: "tokenId", type: "uint256" },
				{ name: "makerAmount", type: "uint256" },
				{ name: "takerAmount", type: "uint256" },
				{ name: "expiration", type: "uint256" },
				{ name: "nonce", type: "uint256" },
				{ name: "feeRateBps", type: "uint256" },
				{ name: "side", type: "uint8" },
				{ name: "signatureType", type: "uint8" },
			],
		},
		message: {
			salt: String(Math.round(Math.random() * Date.now())),
			maker: walletAddress,
			signer: walletAddress,
			taker: "0x0000000000000000000000000000000000000000",
			// Real Polymarket tokenId — "Will ETH hit $5k by end of 2025?"
			tokenId:
				"100946315780975296685442956750612898348523350651979396463945730973585216268024",
			makerAmount: "50000000", // 50 USDC (6 decimals)
			takerAmount: "76923077", // ~76.92 shares
			expiration: "0",
			nonce: "0",
			feeRateBps: "0",
			side: "0", // BUY
			signatureType: "0",
		},
	};
}

export function TestPolymarketOrder() {
	const { signTypedDataV4, account, isConnected } = useLedger();
	const [status, setStatus] = useState<"idle" | "signing" | "success" | "error">("idle");
	const [signature, setSignature] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const handleTest = async () => {
		if (!account) return;
		setStatus("signing");
		setSignature(null);
		setError(null);

		try {
			const order = buildTestOrder(account);
			const sig = await signTypedDataV4(order);
			setSignature(sig);
			setStatus("success");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus("error");
		}
	};

	if (!isConnected) return null;

	return (
		<div className="flex flex-col gap-12 rounded-xl border border-muted p-16">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="body-1-semi-bold text-base">Test Polymarket Order</h3>
					<p className="body-2 text-muted">
						Sign a test BUY 50 USDC order on the Ledger (full MCP flow, not submitted)
					</p>
				</div>
				<Button
					appearance="base"
					onClick={handleTest}
					disabled={status === "signing"}
				>
					{status === "signing" ? <Spinner size="sm" /> : "Sign Test Order"}
				</Button>
			</div>

			{status === "success" && signature && (
				<div className="flex flex-col gap-4">
					<p className="body-2 text-success">Signed successfully</p>
					<code className="body-3 block break-all rounded bg-muted/10 p-8 text-muted">
						{signature}
					</code>
				</div>
			)}

			{status === "error" && error && (
				<p className="body-2 text-error">{error}</p>
			)}
		</div>
	);
}
