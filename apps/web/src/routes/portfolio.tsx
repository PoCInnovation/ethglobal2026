import { Spinner } from "@/components/ui/Spinner";
import { useLedger } from "@/lib/ledger-provider";
import { submitSignedOrder } from "@/lib/polymarket-submit";
import { useWalletAuth } from "@/lib/wallet-auth";
import { Button, Tag } from "@ledgerhq/lumen-ui-react";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

export const Route = createFileRoute("/portfolio")({
	component: PortfolioPage,
});

const POSITIONS_API = "https://data-api.polymarket.com/positions";

interface PolymarketPosition {
	asset: string; // token ID
	conditionId: string;
	size: number; // shares held
	avgPrice: number;
	initialValue: number;
	currentValue: number;
	cashPnl: number;
	percentPnl: number;
	curPrice: number;
	title: string;
	outcome: string;
	slug: string;
	endDate: string;
	redeemable: boolean;
}

async function fetchPositions(wallet: string): Promise<PolymarketPosition[]> {
	const url = `${POSITIONS_API}?user=${wallet}&sizeThreshold=0.01&sortBy=CURRENT&sortDirection=DESC&limit=100`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Positions API error: ${res.status}`);
	return res.json();
}

function PortfolioPage() {
	useWalletAuth();
	const { account, isConnected, signTypedDataV4 } = useLedger();
	const [positions, setPositions] = useState<PolymarketPosition[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selling, setSelling] = useState<string | null>(null);

	const loadPositions = useCallback(async () => {
		if (!account) return;
		setLoading(true);
		setError(null);
		try {
			const pos = await fetchPositions(account);
			setPositions(pos);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load positions");
		} finally {
			setLoading(false);
		}
	}, [account]);

	useEffect(() => {
		loadPositions();
	}, [loadPositions]);

	const handleSell = useCallback(
		async (position: PolymarketPosition) => {
			if (!account) return;
			setSelling(position.asset);
			try {
				const sharesAtomic = BigInt(Math.round(position.size * 1_000_000)).toString();
				const usdcAtomic = BigInt(
					Math.round(position.size * position.curPrice * 1_000_000),
				).toString();

				const order = {
					domain: { name: "ClobAuthDomain", version: "1", chainId: 137 },
					primaryType: "Order" as const,
					types: {
						EIP712Domain: [
							{ name: "name", type: "string" },
							{ name: "version", type: "string" },
							{ name: "chainId", type: "uint256" },
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
						salt: String(Math.floor(Math.random() * 1_000_000_000)),
						maker: account,
						signer: account,
						taker: "0x0000000000000000000000000000000000000000",
						tokenId: position.asset,
						makerAmount: sharesAtomic,
						takerAmount: usdcAtomic,
						expiration: "0",
						nonce: "0",
						feeRateBps: "0",
						side: "1", // SELL
						signatureType: "0",
					},
				};

				const signature = await signTypedDataV4(order);
				console.log("[Portfolio] Sell order signed:", { order: order.message, signature });

				const result = await submitSignedOrder(order.message, signature, account);
				if (!result.success) {
					throw new Error(result.errorMsg || "CLOB submission failed");
				}
				console.log("[Portfolio] Sell order placed:", result);

				// Reload positions
				await loadPositions();
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Sell failed";
				if (!msg.toLowerCase().includes("reject") && !msg.toLowerCase().includes("cancel")) {
					setError(msg);
				}
			} finally {
				setSelling(null);
			}
		},
		[account, signTypedDataV4],
	);

	const totalValue = positions.reduce((sum, p) => sum + p.currentValue, 0);
	const totalPnl = positions.reduce((sum, p) => sum + p.cashPnl, 0);

	return (
		<div className="flex flex-col gap-32">
			<div className="flex flex-col gap-8">
				<h1 className="heading-1-semi-bold text-base">Portfolio</h1>
				<p className="body-1 text-muted">Your Polymarket positions</p>
			</div>

			{!isConnected ? (
				<div className="rounded-lg bg-surface p-24">
					<p className="body-2 text-muted">Connect your Ledger to view positions</p>
				</div>
			) : loading ? (
				<div className="flex items-center justify-center py-32">
					<Spinner size="lg" />
				</div>
			) : error ? (
				<div className="flex flex-col gap-12 rounded-lg bg-surface p-24">
					<p className="body-2 text-error">{error}</p>
					<Button appearance="gray" size="sm" onClick={loadPositions}>
						Retry
					</Button>
				</div>
			) : positions.length === 0 ? (
				<div className="rounded-lg bg-surface p-24">
					<p className="body-2 text-muted">No positions found</p>
				</div>
			) : (
				<div className="flex flex-col gap-16">
					{/* Summary */}
					<div className="flex gap-16">
						<div className="flex flex-col gap-4 rounded-lg bg-surface p-16 flex-1">
							<span className="body-3 text-muted">Total Value</span>
							<span className="heading-4-semi-bold text-base">
								${totalValue.toFixed(2)}
							</span>
						</div>
						<div className="flex flex-col gap-4 rounded-lg bg-surface p-16 flex-1">
							<span className="body-3 text-muted">Total P&L</span>
							<span
								className={`heading-4-semi-bold ${totalPnl >= 0 ? "text-success" : "text-error"}`}
							>
								{totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
							</span>
						</div>
						<div className="flex flex-col gap-4 rounded-lg bg-surface p-16 flex-1">
							<span className="body-3 text-muted">Positions</span>
							<span className="heading-4-semi-bold text-base">{positions.length}</span>
						</div>
					</div>

					{/* Positions list */}
					<div className="flex flex-col gap-8">
						{positions.map((pos) => (
							<div
								key={pos.asset}
								className="flex items-center justify-between rounded-lg border border-muted bg-surface p-16"
							>
								<div className="flex flex-col gap-4 min-w-0 flex-1">
									<span className="body-1-semi-bold text-base truncate">
										{pos.title}
									</span>
									<div className="flex items-center gap-8 flex-wrap">
										<Tag
											appearance={pos.outcome === "Yes" ? "success" : "error"}
											size="sm"
											label={pos.outcome}
										/>
										<span className="body-2 text-muted">
											{pos.size.toFixed(2)} shares
										</span>
										<span className="body-2 text-muted">
											avg ${pos.avgPrice.toFixed(4)}
										</span>
										<span className="body-2 text-muted">
											now ${pos.curPrice.toFixed(4)}
										</span>
										<span className="body-2-semi-bold text-base">
											${pos.currentValue.toFixed(2)}
										</span>
										<span
											className={`body-3 ${pos.cashPnl >= 0 ? "text-success" : "text-error"}`}
										>
											{pos.cashPnl >= 0 ? "+" : ""}${pos.cashPnl.toFixed(2)} (
											{pos.percentPnl >= 0 ? "+" : ""}
											{(pos.percentPnl * 100).toFixed(1)}%)
										</span>
									</div>
								</div>
								<Button
									appearance="red"
									size="sm"
									onClick={() => handleSell(pos)}
									disabled={selling === pos.asset}
								>
									{selling === pos.asset ? "Signing..." : "Sell"}
								</Button>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
