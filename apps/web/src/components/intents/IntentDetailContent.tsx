import { StatusBadge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { encodeERC20Transfer } from "@/lib/erc20";
import { useLedger } from "@/lib/ledger-provider";
import { cn, formatAddress, formatTimeAgo } from "@/lib/utils";
import {
	checkUsdcBalance,
	extractDomain,
	formatAtomicAmount,
	isValidEvmAddress,
	parseEip155ChainId,
	validateX402ForSigning,
} from "@/lib/x402-validation";
import { useUpdateIntentStatus } from "@/queries/intents";
import {
	type Intent,
	type IntentDetails,
	type PolymarketTradeDetails,
	SUPPORTED_CHAINS,
	SUPPORTED_TOKENS,
	type SupportedChainId,
	type TransferIntent,
	type X402PaymentPayload,
	isPolymarketTrade,
	isTransferIntent,
} from "@agent-intents/shared";
import { buildPolymarketOrderTypedData } from "@/lib/polymarket";
import {
	buildOrderFromIntent,
	simulateOrder,
	type SimulationResult,
} from "@/lib/polymarket-order";
import { checkPolymarketConnection, submitSignedOrder } from "@/lib/polymarket-submit";
import { PolymarketIntentDetail } from "./PolymarketIntentDetail";
import { Button, Tag } from "@ledgerhq/lumen-ui-react";
import { Check, Copy } from "@ledgerhq/lumen-ui-react/symbols";
import { useEffect, useState } from "react";
import { verifyTypedData } from "viem";

// =============================================================================
// Types
// =============================================================================

interface PolyTradeProps {
	polyPrice?: number;
	polyShares?: number;
	polyAmount?: string;
	onPolyPriceChange?: (price: number) => void;
	onPolySharesChange?: (shares: number) => void;
}

interface IntentDetailContentProps extends PolyTradeProps {
	intent: Intent;
}

interface IntentActionsProps extends PolyTradeProps {
	intent: Intent;
	onClose: () => void;
}

function base64EncodeUtf8(input: string) {
	const bytes = new TextEncoder().encode(input);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

function randomNonce32BytesHex() {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return `0x${Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")}`;
}

// =============================================================================
// Chain Logo Component (reused from IntentTable)
// =============================================================================

function ChainLogo({ chainId, className }: { chainId: number; className?: string }) {
	if (chainId === 11155111 || chainId === 1) {
		return (
			<div
				className={cn(
					"flex items-center justify-center size-24 rounded-full bg-[#627EEA]",
					className,
				)}
				title="Ethereum"
			>
				<svg
					aria-hidden="true"
					width="12"
					height="12"
					viewBox="0 0 256 417"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M127.961 0L125.166 9.5V285.168L127.961 287.958L255.923 212.32L127.961 0Z"
						fill="white"
						fillOpacity="0.6"
					/>
					<path d="M127.962 0L0 212.32L127.962 287.959V154.158V0Z" fill="white" />
					<path
						d="M127.961 312.187L126.386 314.107V412.306L127.961 416.905L255.999 236.587L127.961 312.187Z"
						fill="white"
						fillOpacity="0.6"
					/>
					<path d="M127.962 416.905V312.187L0 236.587L127.962 416.905Z" fill="white" />
				</svg>
			</div>
		);
	}

	if (chainId === 84532 || chainId === 8453) {
		return (
			<div
				className={cn(
					"flex items-center justify-center size-24 rounded-full bg-[#0052FF]",
					className,
				)}
				title="Base"
			>
				<svg
					aria-hidden="true"
					width="12"
					height="12"
					viewBox="0 0 111 111"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M54.921 110.034C85.359 110.034 110.034 85.402 110.034 55.017C110.034 24.6319 85.359 0 54.921 0C26.0432 0 2.35281 22.1714 0 50.3923H72.8467V59.6416H0C2.35281 87.8625 26.0432 110.034 54.921 110.034Z"
						fill="white"
					/>
				</svg>
			</div>
		);
	}

	if (chainId === 137) {
		return (
			<div
				className={cn(
					"flex items-center justify-center size-24 rounded-full bg-[#8247E5]",
					className,
				)}
				title="Polygon"
			>
				<svg
					aria-hidden="true"
					width="12"
					height="12"
					viewBox="0 0 38 33"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M29.4 11.7c-.8-.5-1.8-.5-2.5 0l-5.8 3.4-4 2.2-5.8 3.4c-.8.5-1.8.5-2.5 0l-4.6-2.7c-.8-.5-1.2-1.3-1.2-2.2v-5.3c0-.9.5-1.7 1.2-2.2l4.5-2.6c.8-.5 1.8-.5 2.5 0l4.5 2.6c.8.5 1.2 1.3 1.2 2.2v3.4l4-2.3v-3.4c0-.9-.5-1.7-1.2-2.2L12.8.5c-.8-.5-1.8-.5-2.5 0L3 4.1C2.2 4.6 1.8 5.4 1.8 6.3v7.1c0 .9.5 1.7 1.2 2.2l7 4c.8.5 1.8.5 2.5 0l5.8-3.3 4-2.3 5.8-3.3c.8-.5 1.8-.5 2.5 0l4.5 2.6c.8.5 1.2 1.3 1.2 2.2v5.3c0 .9-.5 1.7-1.2 2.2l-4.5 2.7c-.8.5-1.8.5-2.5 0l-4.5-2.7c-.8-.5-1.2-1.3-1.2-2.2v-3.4l-4 2.3v3.4c0 .9.5 1.7 1.2 2.2l7 4c.8.5 1.8.5 2.5 0l7-4c.8-.5 1.2-1.3 1.2-2.2v-7.1c0-.9-.5-1.7-1.2-2.2l-7-4z"
						fill="white"
					/>
				</svg>
			</div>
		);
	}

	return (
		<div
			className={cn(
				"flex items-center justify-center size-24 rounded-full bg-muted body-4-semi-bold text-base",
				className,
			)}
			title={`Chain ${chainId}`}
		>
			?
		</div>
	);
}

// =============================================================================
// Copy Button Component
// =============================================================================

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="p-6 rounded-sm hover:bg-muted-transparent transition-colors"
			title="Copy address"
		>
			{copied ? (
				<Check className="size-16 text-success" />
			) : (
				<Copy className="size-16 text-muted" />
			)}
		</button>
	);
}

// =============================================================================
// Category Badge Component
// =============================================================================

function CategoryBadge({ category }: { category: string }) {
	const labels: Record<string, string> = {
		api_payment: "API Payment",
		subscription: "Subscription",
		purchase: "Purchase",
		p2p_transfer: "P2P Transfer",
		defi: "DeFi",
		bill_payment: "Bill Payment",
		donation: "Donation",
		other: "Other",
	};

	return <Tag appearance="gray" size="sm" label={labels[category] ?? category} />;
}

// =============================================================================
// Urgency Badge Component
// =============================================================================

function UrgencyBadge({ urgency }: { urgency: string }) {
	const appearances: Record<string, "gray" | "warning" | "error"> = {
		low: "gray",
		normal: "gray",
		high: "warning",
		critical: "error",
	};

	if (urgency === "low" || urgency === "normal") return null;

	return (
		<Tag
			appearance={appearances[urgency] ?? "gray"}
			size="sm"
			label={`${urgency.charAt(0).toUpperCase() + urgency.slice(1)} Priority`}
		/>
	);
}

// =============================================================================
// Hero Section Component
// =============================================================================

function HeroSection({ intent, displayAmount: overrideAmount }: { intent: Intent; displayAmount?: string }) {
	const { details } = intent;
	const isTransfer = isTransferIntent(details);
	const isPolymarket = isPolymarketTrade(details);
	const isX402 = isTransfer && !!details.x402?.accepted;

	const x402ChainId =
		isX402 && isTransfer ? parseEip155ChainId(details.x402?.accepted?.network ?? "") : null;
	const effectiveChainId = (
		isX402 && x402ChainId ? x402ChainId : details.chainId
	) as SupportedChainId;
	const chain = SUPPORTED_CHAINS[effectiveChainId];

	let displayAmount = overrideAmount ?? details.amount;
	let displayToken = isPolymarket ? "USDC" : isTransfer ? details.token : "—";
	if (isX402 && isTransfer && details.x402?.accepted) {
		displayAmount = formatAtomicAmount(details.x402.accepted.amount, 6);
		displayToken = "USDC";
	}

	const label = isPolymarket
		? "Polymarket Trade"
		: isX402
			? "API Payment"
			: null;

	return (
		<div className="flex flex-col items-center gap-8 py-16">
			{label && (
				<div className="body-3-semi-bold text-interactive uppercase tracking-wide">{label}</div>
			)}
			<div className="heading-2-semi-bold text-base">
				{displayAmount} {displayToken}
			</div>
			<div className="flex items-center gap-8">
				<ChainLogo chainId={effectiveChainId} />
				<span className="body-2 text-muted">on {chain?.name ?? `Chain ${effectiveChainId}`}</span>
			</div>
			<div className="flex items-center gap-8 mt-8">
				<StatusBadge status={intent.status} />
				<UrgencyBadge urgency={intent.urgency} />
			</div>
		</div>
	);
}

// =============================================================================
// Recipient Section Component
// =============================================================================

function RecipientSection({ details }: { details: TransferIntent }) {
	return (
		<div className="rounded-lg bg-muted-transparent p-16">
			<div className="body-3 text-muted mb-6">To</div>
			<div className="flex items-center justify-between gap-8">
				<div className="flex flex-col gap-2 min-w-0">
					<code className="font-mono body-2 text-base break-all">{details.recipient}</code>
					{details.recipientEns && (
						<span className="body-3 text-muted">{details.recipientEns}</span>
					)}
				</div>
				<CopyButton text={details.recipient} />
			</div>
		</div>
	);
}

// =============================================================================
// X402 Payment Details Section Component
// =============================================================================

function X402PaymentSection({ details }: { details: TransferIntent }) {
	const x402 = details.x402;

	if (!x402?.accepted || !x402?.resource) return null;

	const resource = x402.resource;
	const accepted = x402.accepted;
	const chainId = parseEip155ChainId(accepted.network);
	const chain = chainId ? SUPPORTED_CHAINS[chainId as SupportedChainId] : null;
	const domain = extractDomain(resource.url);

	return (
		<div className="rounded-lg bg-interactive/5 p-16 flex flex-col gap-12">
			<div className="flex items-center gap-8">
				<div className="size-8 rounded-full bg-interactive" />
				<span className="body-2-semi-bold text-interactive">x402 Payment Details</span>
			</div>

			{/* Resource/API Endpoint */}
			<div className="flex flex-col gap-4">
				<span className="body-3 text-muted">API Endpoint</span>
				<div className="flex items-center justify-between gap-8">
					<code className="font-mono body-2 text-base truncate flex-1" title={resource.url}>
						{domain}
					</code>
					<CopyButton text={resource.url} />
				</div>
			</div>

			{/* Payment Recipient */}
			<div className="flex flex-col gap-4">
				<span className="body-3 text-muted">Payment Recipient</span>
				<div className="flex items-center justify-between gap-8">
					<code className="font-mono body-2 text-base break-all">{accepted.payTo}</code>
					<CopyButton text={accepted.payTo} />
				</div>
			</div>

			{/* Network */}
			<div className="flex items-center justify-between">
				<span className="body-3 text-muted">Network</span>
				<div className="flex items-center gap-6">
					{chainId && <ChainLogo chainId={chainId} className="size-16" />}
					<span className="body-2 text-base">{chain?.name ?? accepted.network}</span>
				</div>
			</div>

			{/* Payment Scheme */}
			<div className="flex items-center justify-between">
				<span className="body-3 text-muted">Scheme</span>
				<Tag appearance="gray" size="sm" label={`EIP-3009 ${accepted.scheme}`} />
			</div>

			{/* Authorization validity info */}
			{accepted.maxTimeoutSeconds && (
				<div className="border-t border-muted-subtle pt-12">
					<div className="body-3 text-muted">
						Authorization valid for {Math.floor(accepted.maxTimeoutSeconds / 60)} minute
						{accepted.maxTimeoutSeconds >= 120 ? "s" : ""}
					</div>
				</div>
			)}
		</div>
	);
}

// =============================================================================
// Settlement Receipt Section Component (x402)
// =============================================================================

function SettlementReceiptSection({ details }: { details: TransferIntent }) {
	const receipt = details.x402?.settlementReceipt;

	if (!receipt) return null;

	const chainId = receipt.network ? parseEip155ChainId(receipt.network) : null;
	const chain = chainId ? SUPPORTED_CHAINS[chainId as SupportedChainId] : null;

	return (
		<div
			className={cn(
				"rounded-lg p-16 flex flex-col gap-12",
				receipt.success
					? "border border-success/30 bg-success/5"
					: "border border-error/30 bg-error/5",
			)}
		>
			<div className="flex items-center gap-8">
				<div className={cn("size-8 rounded-full", receipt.success ? "bg-success" : "bg-error")} />
				<span className={cn("body-2-semi-bold", receipt.success ? "text-success" : "text-error")}>
					{receipt.success ? "Payment Settled" : "Settlement Failed"}
				</span>
			</div>

			{/* Transaction hash */}
			{receipt.txHash && (
				<div className="flex flex-col gap-4">
					<span className="body-3 text-muted">Transaction</span>
					<div className="flex items-center justify-between gap-8">
						<code className="font-mono body-2 text-base">{formatAddress(receipt.txHash)}</code>
						<CopyButton text={receipt.txHash} />
					</div>
				</div>
			)}

			{/* Network */}
			{chain && (
				<div className="flex items-center justify-between">
					<span className="body-3 text-muted">Network</span>
					<div className="flex items-center gap-6">
						{chainId && <ChainLogo chainId={chainId} className="size-16" />}
						<span className="body-2 text-base">{chain.name}</span>
					</div>
				</div>
			)}

			{/* Block number */}
			{receipt.blockNumber && (
				<div className="flex items-center justify-between">
					<span className="body-3 text-muted">Block</span>
					<span className="body-2 text-base font-mono">{receipt.blockNumber}</span>
				</div>
			)}

			{/* Settled at */}
			{receipt.settledAt && (
				<div className="flex items-center justify-between">
					<span className="body-3 text-muted">Settled</span>
					<span className="body-2 text-base">{formatTimeAgo(receipt.settledAt)}</span>
				</div>
			)}

			{/* Error message */}
			{receipt.error && (
				<div className="border-t border-error/30 pt-12">
					<p className="body-3 text-error">{receipt.error}</p>
				</div>
			)}
		</div>
	);
}

// =============================================================================
// Merchant Section Component
// =============================================================================

function MerchantSection({ details }: { details: TransferIntent }) {
	const { merchant, category, memo } = details;

	if (!merchant && !category && !memo) return null;

	return (
		<div className="rounded-lg bg-muted-transparent p-16 flex flex-col gap-12">
			{merchant && (
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-12">
						{merchant.logo ? (
							<img src={merchant.logo} alt={merchant.name} className="size-32 rounded-full" />
						) : (
							<div className="size-32 rounded-full bg-muted flex items-center justify-center body-3-semi-bold text-muted">
								{merchant.name.charAt(0)}
							</div>
						)}
						<span className="body-1-semi-bold text-base">{merchant.name}</span>
					</div>
					{merchant.verified && <Tag appearance="success" size="sm" label="Verified" />}
				</div>
			)}

			{category && (
				<div className="flex items-center gap-8">
					<CategoryBadge category={category} />
				</div>
			)}

			{memo && (
				<div className="border-t border-muted-subtle pt-12">
					<p className="body-2 text-muted italic">"{memo}"</p>
				</div>
			)}
		</div>
	);
}

// =============================================================================
// Agent Section Component
// =============================================================================

function AgentSection({ intent }: { intent: Intent }) {
	const { details } = intent;
	const resource = isTransferIntent(details) ? details.resource : undefined;

	return (
		<div className="flex flex-col gap-8">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-8">
					<div className="size-24 rounded-full bg-interactive flex items-center justify-center">
						<span className="body-4-semi-bold text-on-interactive">
							{intent.agentName.charAt(0)}
						</span>
					</div>
					<span className="body-2 text-base">{intent.agentName}</span>
				</div>
				<span className="body-3 text-muted">{formatTimeAgo(intent.createdAt)}</span>
			</div>

			{resource && (
				<div className="body-3 text-muted truncate" title={resource}>
					Resource: {resource}
				</div>
			)}

			{intent.expiresAt && (
				<div className="body-3 text-warning">Expires {formatTimeAgo(intent.expiresAt)}</div>
			)}
		</div>
	);
}

// =============================================================================
// Technical Details Section Component
// =============================================================================

function TechnicalDetailsSection({ intent }: { intent: Intent }) {
	const [isExpanded, setIsExpanded] = useState(false);
	const { details } = intent;

	const token = isTransferIntent(details) ? details.token : "USDC";
	const tokenInfo = SUPPORTED_TOKENS[details.chainId as SupportedChainId]?.[token];
	const tokenAddress = isTransferIntent(details)
		? ((details.tokenAddress as string | undefined) ?? tokenInfo?.address)
		: tokenInfo?.address;

	return (
		<div className="border-t border-muted-subtle pt-16">
			<button
				type="button"
				onClick={() => setIsExpanded(!isExpanded)}
				className="flex items-center gap-8 body-3-semi-bold text-muted hover:text-base transition-colors w-full"
			>
				<span className={cn("transition-transform", isExpanded && "rotate-90")}>▶</span>
				Technical Details
			</button>

			{isExpanded && (
				<div className="mt-12 flex flex-col gap-8 body-3 text-muted">
					<div className="flex flex-col gap-4">
						<span>Intent ID</span>
						<code className="font-mono text-base break-all">{intent.id}</code>
					</div>
					{tokenAddress && (
						<div className="flex flex-col gap-4">
							<span>Token Contract</span>
							<code className="font-mono text-base break-all">{tokenAddress}</code>
						</div>
					)}
					<div className="flex justify-between">
						<span>Agent ID</span>
						<code className="font-mono text-base">{intent.agentId}</code>
					</div>
					{intent.statusHistory.length > 0 && (
						<div className="flex flex-col gap-4 mt-8">
							<span className="body-3-semi-bold">Timeline</span>
							{intent.statusHistory.map((entry, idx) => {
								const date = new Date(entry.timestamp);
								const formatted = `${date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
								const label =
									entry.status === "pending"
										? "Created"
										: entry.status === "broadcasting" || entry.status === "confirmed"
											? "Broadcasted"
											: entry.status === "authorized"
												? "Authorized"
												: entry.status === "rejected"
													? "Rejected"
													: entry.status === "failed"
														? "Failed"
														: entry.status.charAt(0).toUpperCase() + entry.status.slice(1);
								return (
									<div
										key={`${entry.status}-${entry.timestamp}`}
										className="flex justify-between text-muted"
									>
										<span>{label}</span>
										<span className="font-mono">{formatted}</span>
									</div>
								);
							})}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// =============================================================================
// Actions Component
// =============================================================================

function IntentActions({ intent, onClose, polyAmount: externalPolyAmount, polyPrice: externalPolyPrice, polyShares: externalPolyShares, onPolyPriceChange, onPolySharesChange }: IntentActionsProps) {
	const {
		chainId: walletChainId,
		sendTransaction,
		signTypedDataV4,
		account,
		dismissDeviceAction,
	} = useLedger();
	const updateStatus = useUpdateIntentStatus();

	const [isSigning, setIsSigning] = useState(false);
	const [isRejecting, setIsRejecting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [polySimPreview, setPolySimPreview] = useState<SimulationResult | null>(null);
	const [polyPricePreview, setPolyPricePreview] = useState<"idle" | "loading" | "ready" | "error">(
		"idle",
	);

	// Use lifted state from dialog
	const polyAmount = externalPolyAmount ?? "0";
	const polyPrice = externalPolyPrice ?? 0;
	const polyShares = externalPolyShares ?? 0;

	const { details } = intent;
	const isTransfer = isTransferIntent(details);
	const isPolymarket = isPolymarketTrade(details);
	const intentChainId = details.chainId as SupportedChainId;
	const chain = SUPPORTED_CHAINS[intentChainId];
	const isWrongChain = walletChainId !== null && walletChainId !== intentChainId;
	const isPending = intent.status === "pending";

	const token = isTransfer ? details.token : "USDC";
	const tokenInfo = SUPPORTED_TOKENS[intentChainId]?.[token];
	const tokenAddress = isTransfer
		? ((details.tokenAddress as `0x${string}` | undefined) ??
			(tokenInfo?.address as `0x${string}` | undefined))
		: undefined;
	const tokenDecimals = tokenInfo?.decimals ?? 6;
	const isX402 = isTransfer && !!details.x402?.accepted;

	const x402ChainId =
		isX402 && isTransfer ? parseEip155ChainId(details.x402?.accepted?.network ?? "") : null;
	const effectiveChainId = isX402 && x402ChainId ? x402ChainId : intentChainId;
	const effectiveChain = SUPPORTED_CHAINS[effectiveChainId as SupportedChainId];
	const isEffectiveWrongChain = walletChainId !== null && walletChainId !== effectiveChainId;

	// Simulation: fetch live price when dialog opens for a polymarket intent
	const polyDetailsForPreview = isPolymarket ? (details as PolymarketTradeDetails) : null;
	useEffect(() => {
		if (!isPolymarket || !isPending || !polyDetailsForPreview?.tokenId) {
			setPolySimPreview(null);
			setPolyPricePreview("idle");
			return;
		}
		const tokenId = polyDetailsForPreview.tokenId;
		let cancelled = false;
		setPolySimPreview(null);
		setPolyPricePreview("loading");
		simulateOrder(tokenId)
			.then((s) => {
				if (cancelled) return;
				setPolySimPreview(s);
				// Update the lifted price with the live simulation price
				const rounded = Math.round(s.price * 100) / 100;
				const clamped = Math.min(0.99, Math.max(0.01, rounded));
				onPolyPriceChange?.(clamped);
				setPolyPricePreview("ready");
			})
			.catch(() => {
				if (cancelled) return;
				// Fallback to intent's outcomePrice
				const op = polyDetailsForPreview.outcomePrice;
				if (op != null && op > 0 && op < 1) {
					const clamped = Math.min(0.99, Math.max(0.01, Math.round(op * 100) / 100));
					onPolyPriceChange?.(clamped);
					setPolyPricePreview("ready");
				} else {
					setPolyPricePreview("error");
				}
			});
		return () => {
			cancelled = true;
		};
	}, [isPolymarket, isPending, intent.id, polyDetailsForPreview?.tokenId, polyDetailsForPreview?.outcomePrice]);

	const polySignReady =
		!isPolymarket ||
		((polyPricePreview === "ready" || polyPricePreview === "error") &&
			polyPrice > 0 &&
			polyShares >= 5);

	const handleSign = async () => {
		setError(null);

		// Polymarket path: build EIP-712 order, sign on Ledger, submit to CLOB.
		// Chain validation is skipped here: the chainId is embedded in the EIP-712
		// domain and enforced by the Polymarket exchange contract.
		if (isPolymarket) {
			if (!account) {
				setError("Connect your Ledger device to sign this trade");
				return;
			}
			const polyDetails = details as PolymarketTradeDetails;
			if (!polyDetails.tokenId) {
				setError("Market data incomplete (missing tokenId). Please try again.");
				return;
			}
			const connected = await checkPolymarketConnection();
			if (!connected) {
				setError("Connect to Polymarket first (Settings > Polymarket)");
				return;
			}
			if (polyPrice <= 0 || polyPrice >= 1) {
				setError("Price unavailable — please wait for quote or retry");
				return;
			}
			if (polyShares < 5) {
				setError(`Minimum 5 shares required (current: ${polyShares}).`);
				return;
			}
			const userAmount = Number.parseFloat(polyAmount);
			if (!Number.isFinite(userAmount) || userAmount <= 0) {
				setError("Enter a valid USDC amount");
				return;
			}

			setIsSigning(true);
			try {
				// Step 0: Persist user-specified amount to the backend intent
				if (String(userAmount) !== polyDetails.amount) {
					await fetch("/api/intents/update-amount", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						credentials: "include",
						body: JSON.stringify({ id: intent.id, amount: String(userAmount) }),
					});
				}

				// Step 1: CRE — trigger on-chain write + read verified market data
				console.log("[Polymarket] Verifying market via CRE oracle for conditionId:", polyDetails.conditionId);
				const verifyRes = await fetch("/api/polymarket/verify", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify({ conditionId: polyDetails.conditionId, outcome: polyDetails.outcome }),
				});
				if (!verifyRes.ok) {
					const err = await verifyRes.json().catch(() => ({}));
					throw new Error(err?.error || `Market verification failed (${verifyRes.status})`);
				}
				const verifiedMarket = await verifyRes.json();
				console.log("[Polymarket] Verified market:", verifiedMarket);

				// Check market still active according to oracle
				if (!verifiedMarket.active) {
					throw new Error(`Market is no longer active: "${verifiedMarket.question}"`);
				}

				// Use oracle-verified tokenId if available (on-chain source), else keep intent's tokenId
				const effectiveTokenId = verifiedMarket.tokenId || polyDetails.tokenId;

				// Step 2: Simulate — fetch latest live price (price must always be fresh)
				console.log("[Polymarket] Simulating order for tokenId:", effectiveTokenId);
				const simulation = await simulateOrder(effectiveTokenId);
				console.log("[Polymarket] Simulation:", simulation);

				// Step 3: Build order with user-specified price, shares→amount, and oracle-verified data
				const enrichedDetails = { ...polyDetails, marketTitle: verifiedMarket.question, tokenId: effectiveTokenId, amount: String(userAmount) };
				const order = buildOrderFromIntent(enrichedDetails, account, simulation, { limitPrice: polyPrice });
				console.log("[Polymarket] Order built (oracle source:", verifiedMarket.source, ", price:", polyPrice, ", shares:", polyShares, ", amount:", userAmount, "):", order.message);

				// Step 4: Sign on Ledger
				const signature = await signTypedDataV4(order);
				console.log("[Polymarket] Signed:", signature);

				// Step 5: Submit to CLOB
				const result = await submitSignedOrder(order.message, signature, account);
				if (!result.success) {
					throw new Error(result.errorMsg || "CLOB submission failed");
				}
				console.log("[Polymarket] Order placed:", result);

				await updateStatus.mutateAsync({
					id: intent.id,
					status: "confirmed",
					note: `Polymarket order placed (orderID: ${result.orderID ?? "unknown"})`,
				});
				onClose();
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Signing failed";
				const lowerMsg = msg.toLowerCase();
				const isUserRejection =
					lowerMsg.includes("reject") ||
					lowerMsg.includes("cancel") ||
					lowerMsg.includes("denied") ||
					lowerMsg.includes("user") ||
					lowerMsg.includes("abort");
				dismissDeviceAction();
				if (isUserRejection) {
					setError("Trade signing cancelled");
				} else {
					setError(msg);
				}
			} finally {
				setIsSigning(false);
			}
			return;
		}

		// x402 path: sign an EIP-712 authorization (EIP-3009), then store PAYMENT-SIGNATURE header.
		if (isX402 && isTransfer) {
			const transferDetails = details as TransferIntent;
			if (!account) {
				setError("Connect your Ledger device to authorize this payment");
				return;
			}

			// Validate account address
			if (!isValidEvmAddress(account)) {
				setError("Invalid wallet address");
				return;
			}

			const x402 = transferDetails.x402;

			// Strong validation of x402 requirements
			const validation = validateX402ForSigning(x402?.resource, x402?.accepted);
			if (!validation.valid) {
				setError(validation.error ?? "Invalid x402 payment requirements");
				return;
			}

			// At this point x402, resource, and accepted are guaranteed by validateX402ForSigning
			const resource = x402!.resource!;
			const accepted = x402!.accepted!;

			const chainId = parseEip155ChainId(accepted.network);
			if (!chainId) {
				setError(`Unsupported x402 network: ${accepted.network}`);
				return;
			}

			// Require wallet to be on the correct chain
			if (walletChainId === null) {
				setError("Wallet must be connected to sign");
				return;
			}
			if (walletChainId !== chainId) {
				setError(
					`Switch to ${SUPPORTED_CHAINS[chainId as SupportedChainId]?.name ?? `Chain ${chainId}`} to authorize this API payment`,
				);
				return;
			}

			// Pre-sign USDC balance check: avoid wasting a Ledger interaction if
			// the user doesn't have enough USDC to cover the payment.
			const balanceError = await checkUsdcBalance(
				account,
				accepted.asset,
				accepted.amount,
				chainId,
			);
			if (balanceError) {
				setError(balanceError);
				return;
			}

			const nowSec = Math.floor(Date.now() / 1000);
			const timeout = accepted.maxTimeoutSeconds ?? 300; // Increase default to 5 minutes
			const authorization = {
				from: account,
				to: accepted.payTo,
				value: accepted.amount,
				validAfter: String(nowSec),
				validBefore: String(nowSec + timeout),
				nonce: randomNonce32BytesHex(),
			};

			// Build EIP-712 typed data for TransferWithAuthorization (EIP-3009)
			// Note: extra.name and extra.version are required (validated above)
			const domain = {
				name: accepted.extra?.name,
				version: accepted.extra?.version,
				chainId: BigInt(chainId),
				verifyingContract: accepted.asset as `0x${string}`,
			};

			const types = {
				TransferWithAuthorization: [
					{ name: "from", type: "address" },
					{ name: "to", type: "address" },
					{ name: "value", type: "uint256" },
					{ name: "validAfter", type: "uint256" },
					{ name: "validBefore", type: "uint256" },
					{ name: "nonce", type: "bytes32" },
				],
			} as const;

			const message = {
				from: account as `0x${string}`,
				to: accepted.payTo as `0x${string}`,
				value: BigInt(accepted.amount),
				validAfter: BigInt(authorization.validAfter),
				validBefore: BigInt(authorization.validBefore),
				nonce: authorization.nonce as `0x${string}`,
			};

			// Format for eth_signTypedData_v4 (includes EIP712Domain type)
			const typedDataForSign = {
				types: {
					EIP712Domain: [
						{ name: "name", type: "string" },
						{ name: "version", type: "string" },
						{ name: "chainId", type: "uint256" },
						{ name: "verifyingContract", type: "address" },
					],
					...types,
				},
				primaryType: "TransferWithAuthorization" as const,
				domain: {
					...domain,
					chainId: Number(domain.chainId), // JSON serialization needs number
				},
				message: {
					...authorization,
					value: authorization.value, // Keep as string for JSON
				},
			};

			setIsSigning(true);
			try {
				const signature = await signTypedDataV4(typedDataForSign);

				// Best-effort local verification – if it fails (e.g. non-standard
				// signature encoding from the device) we still proceed because the
				// on-chain contract will enforce the real check.
				try {
					const isValid = await verifyTypedData({
						address: account as `0x${string}`,
						domain,
						types,
						primaryType: "TransferWithAuthorization",
						message,
						signature: signature as `0x${string}`,
					});

					if (!isValid) {
						console.warn("Local signature verification returned false – proceeding anyway");
					}
				} catch (verifyErr) {
					console.warn("Local signature verification failed:", verifyErr);
				}

				const paymentPayload: X402PaymentPayload = {
					x402Version: 2,
					resource,
					accepted,
					payload: { signature, authorization },
					extensions: {},
				};

				const paymentSignatureHeader = base64EncodeUtf8(JSON.stringify(paymentPayload));

				// Compute expiry from validBefore (Unix seconds -> ISO string)
				const expiresAt = new Date(Number(authorization.validBefore) * 1000).toISOString();

				await updateStatus.mutateAsync({
					id: intent.id,
					status: "authorized", // x402 payment authorized
					paymentSignatureHeader,
					paymentPayload,
					expiresAt,
				});

				onClose();
		} catch (err) {
			const message = err instanceof Error ? err.message : "Signature failed";
			const lowerMessage = message.toLowerCase();
			const isUserRejection =
				lowerMessage.includes("reject") ||
				lowerMessage.includes("cancel") ||
				lowerMessage.includes("denied") ||
				lowerMessage.includes("user");
			dismissDeviceAction();
			if (isUserRejection) {
				setError("Authorization cancelled");
			} else {
				setError(message);
			}
		} finally {
			setIsSigning(false);
		}

		return;
		}

		// Check chain mismatch for standard transfers
		if (isWrongChain) {
			setError(`Please switch to ${chain?.name ?? "the correct network"} to sign`);
			return;
		}

		// At this point we know it's a transfer intent (polymarket + x402 returned above)
		const transferDet = details as TransferIntent;
		if (!tokenAddress) {
			setError(`Unknown token address for ${token}`);
			return;
		}

		const encodeResult = encodeERC20Transfer(
			transferDet.recipient as `0x${string}`,
			transferDet.amount,
			tokenDecimals,
		);

		if (!encodeResult.success) {
			setError(encodeResult.error);
			return;
		}

		setIsSigning(true);

		try {
			const txHash = await sendTransaction({
				to: tokenAddress,
				data: encodeResult.data,
				value: "0x0",
			});

			await updateStatus.mutateAsync({
				id: intent.id,
				status: "broadcasting",
				txHash,
			});

			onClose();
		} catch (err) {
			const message = err instanceof Error ? err.message : "Transaction failed";

			const lowerMessage = message.toLowerCase();
			const isUserRejection =
				lowerMessage.includes("reject") ||
				lowerMessage.includes("cancel") ||
				lowerMessage.includes("denied") ||
				lowerMessage.includes("closed") ||
				lowerMessage.includes("close") ||
				lowerMessage.includes("user") ||
				lowerMessage.includes("abort");

			dismissDeviceAction();

			if (!isUserRejection) {
				try {
					await updateStatus.mutateAsync({
						id: intent.id,
						status: "failed",
						note: message,
					});
				} catch {
					// Ignore status update failure
				}
			}

			setError(message);
		} finally {
			setIsSigning(false);
		}
	};

	const handleReject = async () => {
		setError(null);
		setIsRejecting(true);

		try {
			await updateStatus.mutateAsync({
				id: intent.id,
				status: "rejected",
			});
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to reject");
		} finally {
			setIsRejecting(false);
		}
	};

	if (!isPending) {
		return (
			<Button appearance="base" onClick={onClose} isFull>
				Close
			</Button>
		);
	}

	return (
		<div className="flex flex-col gap-12 w-full">
			{error && (
				<div className="rounded-sm bg-error-transparent px-12 py-8 body-3 text-error">{error}</div>
			)}

			{isPolymarket && isPending && polyPricePreview === "loading" && (
				<span className="body-3 text-muted">Loading quote…</span>
			)}

			{/* Chain mismatch warning - use effective chain for x402 */}
			{isEffectiveWrongChain && (
				<div className="rounded-sm bg-warning-transparent px-12 py-8 body-3 text-warning">
					Switch to {effectiveChain?.name ?? "the correct network"} to{" "}
					{isX402 ? "authorize" : "sign"}
				</div>
			)}

			<div className="flex gap-12 w-full">
				<Button
					appearance="gray"
					onClick={handleReject}
					disabled={isSigning || isRejecting || updateStatus.isPending}
					isFull
				>
					{isRejecting ? <Spinner size="sm" /> : "Reject"}
				</Button>
				<Button
					appearance="base"
					onClick={handleSign}
					disabled={
						isSigning ||
						isRejecting ||
						isEffectiveWrongChain ||
						updateStatus.isPending ||
						(isPolymarket && !polySignReady)
					}
					isFull
				>
					{isSigning ? <Spinner size="sm" /> : isX402 ? "Authorize" : "Sign with Ledger"}
				</Button>
			</div>
		</div>
	);
}

// =============================================================================
// Main Content Component
// =============================================================================

export function IntentDetailContent({ intent, polyAmount, polyPrice, polyShares, onPolyPriceChange, onPolySharesChange }: IntentDetailContentProps) {
	const { details } = intent;
	const isTransfer = isTransferIntent(details);
	const isPolymarket = isPolymarketTrade(details);
	const isX402 = isTransfer && !!details.x402?.accepted;
	const hasSettlementReceipt = isTransfer && !!details.x402?.settlementReceipt;

	const isPending = intent.status === "pending";

	return (
		<div className="flex flex-col gap-16">
			<HeroSection intent={intent} displayAmount={isPolymarket && polyAmount ? polyAmount : undefined} />
			{hasSettlementReceipt && isTransfer && (
				<SettlementReceiptSection details={details} />
			)}
			{isPolymarket ? (
				<PolymarketIntentDetail
					details={details}
					editable={isPending}
					polyPrice={polyPrice}
					polyShares={polyShares}
					polyAmount={polyAmount}
					onPriceChange={onPolyPriceChange}
					onSharesChange={onPolySharesChange}
				/>
			) : isX402 && isTransfer ? (
				<X402PaymentSection details={details} />
			) : isTransfer ? (
				<RecipientSection details={details} />
			) : null}
			{isTransfer && <MerchantSection details={details} />}
			<AgentSection intent={intent} />
			<TechnicalDetailsSection intent={intent} />
		</div>
	);
}

// Attach Actions as a static property for use in DialogFooter
IntentDetailContent.Actions = IntentActions;
