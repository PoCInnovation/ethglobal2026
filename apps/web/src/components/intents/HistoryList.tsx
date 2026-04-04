import { IntentDetailDialog } from "@/components/intents/IntentDetailDialog";
import { StatusBadge } from "@/components/ui/Badge";
import { ChainLogo } from "@/components/ui/ChainLogo";
import { Spinner } from "@/components/ui/Spinner";
import { useLedger } from "@/lib/ledger-provider";
import { formatAddress } from "@/lib/utils";
import { useWalletAuth } from "@/lib/wallet-auth";
import { intentsQueryOptions } from "@/queries/intents";
import type { Intent, SupportedChainId } from "@agent-intents/shared";
import { SUPPORTED_CHAINS, isPolymarketTrade, isTransferIntent } from "@agent-intents/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

const COMPLETED_STATUSES = new Set([
	"approved",
	"broadcasting",
	"authorized",
	"confirmed",
	"rejected",
	"failed",
	"expired",
]);

function getBroadcastedDate(intent: Intent): Date {
	const broadcastEntry = intent.statusHistory
		.slice()
		.reverse()
		.find(
			(e) => e.status === "broadcasting" || e.status === "confirmed" || e.status === "authorized",
		);
	if (broadcastEntry) return new Date(broadcastEntry.timestamp);
	return new Date(intent.createdAt);
}

function UsdcLogo() {
	return (
		<svg
			aria-hidden="true"
			className="size-20 rounded-full shrink-0"
			viewBox="0 0 2000 2000"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M1000 2000c554.17 0 1000-445.83 1000-1000S1554.17 0 1000 0 0 445.83 0 1000s445.83 1000 1000 1000z"
				fill="#2775ca"
			/>
			<path
				d="M1275 1158.33c0-145.83-87.5-195.83-262.5-216.66-125-16.67-150-50-150-108.34s41.67-95.83 125-95.83c75 0 116.67 25 137.5 87.5 4.17 12.5 16.67 20.83 29.17 20.83h66.66c16.67 0 29.17-12.5 29.17-29.16v-4.17c-16.67-91.67-91.67-162.5-187.5-170.83v-100c0-16.67-12.5-29.17-33.33-33.34h-62.5c-16.67 0-29.17 12.5-33.34 33.34v95.83c-125 16.67-204.16 100-204.16 204.17 0 137.5 83.33 191.66 258.33 212.5 116.67 20.83 154.17 45.83 154.17 112.5s-58.34 112.5-137.5 112.5c-108.34 0-145.84-45.84-158.34-108.34-4.16-16.66-16.66-25-29.16-25h-70.84c-16.66 0-29.16 12.5-29.16 29.17v4.17c16.66 104.16 83.33 179.16 220.83 200v100c0 16.66 12.5 29.16 33.33 33.33h62.5c16.67 0 29.17-12.5 33.34-33.33v-100c125-20.84 208.33-108.34 208.33-220.84z"
				fill="#fff"
			/>
		</svg>
	);
}

function ExternalLinkIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M15 3h6v6" />
			<path d="M10 14 21 3" />
			<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
		</svg>
	);
}

function HistoryRow({
	intent,
	account,
	onSelect,
}: {
	intent: Intent;
	account: string | null;
	onSelect: () => void;
}) {
	const { details } = intent;
	const isPolymarket = isPolymarketTrade(details);
	const isTransfer = isTransferIntent(details);
	const chainId = details.chainId as SupportedChainId;
	const chain = SUPPORTED_CHAINS[chainId];
	const token = isTransfer ? details.token : "USDC";

	const txDate = getBroadcastedDate(intent);
	const formattedDate = txDate.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
	const formattedTime = txDate.toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	});

	const summary = isPolymarket
		? details.memo || `${details.outcome} on ${details.marketTitle}`
		: details.memo || `${details.amount} ${(details as { token?: string }).token ?? "USDC"} transfer`;

	const toLabel = isPolymarket
		? "Polymarket"
		: isTransfer
			? formatAddress(details.recipient)
			: "\u2014";

	return (
		<button
			type="button"
			onClick={onSelect}
			className="flex items-center gap-16 rounded-lg bg-surface hover:bg-surface-hover transition-colors p-16 text-left w-full"
		>
			<ChainLogo chainId={chainId} />

			<div className="flex flex-col gap-2 flex-1 min-w-0">
				<div className="flex items-center gap-8">
					<span className="body-2-semi-bold text-base truncate">{summary}</span>
				</div>
				<div className="flex items-center gap-8">
					<span className="body-3 text-muted">{account ? formatAddress(account) : "\u2014"}</span>
					<span className="body-3 text-muted-subtle">&rarr;</span>
					<span className="body-3 text-muted">{toLabel}</span>
					{chain && (
						<>
							<span className="body-3 text-muted-subtle">&middot;</span>
							<span className="body-3 text-muted-subtle">{chain.name}</span>
						</>
					)}
				</div>
			</div>

			<div className="flex flex-col items-end gap-2 shrink-0 w-96">
				<span className="body-3 text-base">{formattedDate}</span>
				<span className="body-3 text-base">{formattedTime}</span>
			</div>

			<div className="flex items-center justify-end gap-8 shrink-0 w-96">
				<span className="body-2-semi-bold text-base">
					{details.amount} {token}
				</span>
				{token === "USDC" && <UsdcLogo />}
			</div>

			<div className="shrink-0 w-112">
				<StatusBadge status={intent.status} />
			</div>

			<div
				className="shrink-0 w-128"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
			>
				{intent.txUrl ? (
					<a
						href={intent.txUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-6 rounded-xs bg-muted-transparent px-8 py-4 body-3 text-muted hover:text-base hover:bg-muted-hover transition-colors"
					>
						{formatAddress(intent.txUrl.split("/").pop() ?? "")}
						<ExternalLinkIcon className="size-14" />
					</a>
				) : (
					<span className="body-3 text-muted-subtle">&mdash;</span>
				)}
			</div>
		</button>
	);
}

export function HistoryList() {
	const { account, isConnected } = useLedger();
	const { status: authStatus, error: authError } = useWalletAuth();

	const {
		data: intents,
		isLoading,
		error,
	} = useQuery({
		...intentsQueryOptions(account?.toLowerCase() ?? ""),
		enabled: isConnected && !!account && authStatus === "authed",
	});

	const completedIntents = intents
		?.filter((i) => COMPLETED_STATUSES.has(i.status))
		.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

	const [selectedIntent, setSelectedIntent] = useState<Intent | null>(null);
	const [isDialogOpen, setIsDialogOpen] = useState(false);

	return (
		<div className="flex flex-col gap-16">
			{/* Auth in progress */}
			{isConnected &&
				(authStatus === "checking" ||
					authStatus === "authing" ||
					authStatus === "unauthenticated" ||
					authStatus === "error") && (
					<div className="flex flex-col items-center gap-8 py-12">
						<div className="flex items-center gap-8">
							<Spinner size="sm" />
							<span className="body-2 text-muted">
								{authStatus === "checking"
									? "Checking session..."
									: authStatus === "error"
										? "Retrying authentication..."
										: "Authenticating..."}
							</span>
						</div>
						{authStatus === "error" && authError && (
							<span className="body-3 text-muted-subtle">{authError.message}</span>
						)}
					</div>
				)}

			{/* Error */}
			{error && (
				<div className="rounded-md bg-error-transparent px-16 py-12 body-2 text-error">
					Failed to load history: {error.message}
				</div>
			)}

			{/* Loading */}
			{isLoading && (
				<div className="flex items-center justify-center py-48">
					<Spinner size="lg" className="text-muted" />
				</div>
			)}

			{/* Not connected */}
			{!isConnected && (
				<div className="flex flex-col items-center gap-16 py-48">
					<div className="size-64 rounded-full bg-muted-transparent flex items-center justify-center">
						<svg
							aria-hidden="true"
							width="32"
							height="32"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="text-muted"
						>
							<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
							<path d="M7 11V7a5 5 0 0 1 10 0v4" />
						</svg>
					</div>
					<div className="text-center">
						<p className="body-1-semi-bold text-base">Connect your Ledger</p>
						<p className="body-2 text-muted mt-4">to view proposal history</p>
					</div>
				</div>
			)}

			{/* Empty */}
			{!isLoading &&
				isConnected &&
				authStatus === "authed" &&
				(!completedIntents || completedIntents.length === 0) && (
					<div className="flex flex-col items-center gap-16 py-48">
						<div className="size-64 rounded-full bg-muted-transparent flex items-center justify-center">
							<svg
								aria-hidden="true"
								width="32"
								height="32"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="text-muted"
							>
								<path d="M22 12h-4l-3 9L9 3l-3 9H2" />
							</svg>
						</div>
						<div className="text-center">
							<p className="body-1-semi-bold text-base">No proposals yet</p>
							<p className="body-2 text-muted mt-4">
								Proposals you review will appear here
							</p>
						</div>
					</div>
				)}

			{/* History rows */}
			{!isLoading && completedIntents && completedIntents.length > 0 && (
				<div className="flex flex-col gap-8">
					{completedIntents.map((intent) => (
						<HistoryRow
							key={intent.id}
							intent={intent}
							account={account}
							onSelect={() => {
								setSelectedIntent(intent);
								setIsDialogOpen(true);
							}}
						/>
					))}
				</div>
			)}

			<IntentDetailDialog
				intent={selectedIntent}
				open={isDialogOpen}
				onOpenChange={(open) => {
					setIsDialogOpen(open);
					if (!open) setSelectedIntent(null);
				}}
			/>
		</div>
	);
}
