import { StatusBadge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { useLedger } from "@/lib/ledger-provider";
import { useWalletAuth } from "@/lib/wallet-auth";
import { formatTimeAgo } from "@/lib/utils";
import { intentsQueryOptions, useUpdateIntentStatus } from "@/queries/intents";
import type { Intent } from "@agent-intents/shared";
import { isPolymarketTrade, isTransferIntent } from "@agent-intents/shared";
import { AmountDisplay, type FormattedValue, Button, Tag } from "@ledgerhq/lumen-ui-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { IntentDetailDialog } from "./IntentDetailDialog";

// =============================================================================
// Helpers
// =============================================================================

function sortIntents(intents: Intent[]): Intent[] {
	return [...intents].sort((a, b) => {
		if (a.status === "pending" && b.status !== "pending") return -1;
		if (a.status !== "pending" && b.status === "pending") return 1;
		return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
	});
}

function calculatePendingTotal(intents: Intent[]): number {
	return intents
		.filter((i) => i.status === "pending")
		.reduce((sum, i) => sum + Number.parseFloat(i.details.amount), 0);
}

const usdcFormatter = (value: number): FormattedValue => {
	const [integerPart = "0", decimalPart = "00"] = value.toFixed(2).split(".");
	return {
		integerPart,
		decimalPart,
		currencyText: "$",
		decimalSeparator: ".",
		currencyPosition: "start",
	};
};

function getProposalSummary(intent: Intent): string {
	const { details } = intent;
	if (isPolymarketTrade(details)) {
		const side = details.outcome === "Yes" ? "YES" : "NO";
		const title =
			details.marketTitle.length > 50
				? `${details.marketTitle.slice(0, 50)}...`
				: details.marketTitle;
		return `Buy ${side} on "${title}"`;
	}
	if (isTransferIntent(details)) {
		const recipient = details.recipientEns || `${details.recipient.slice(0, 6)}...${details.recipient.slice(-4)}`;
		return `Send ${details.amount} ${details.token} to ${recipient}`;
	}
	return `${(details as { amount: string }).amount} USDC`;
}

function getProposalType(intent: Intent): { label: string; color: string } {
	if (isPolymarketTrade(intent.details)) {
		return { label: "Trade", color: "bg-[#8247E5]" };
	}
	if (isTransferIntent(intent.details) && intent.details.x402?.accepted) {
		return { label: "API Payment", color: "bg-interactive" };
	}
	return { label: "Transfer", color: "bg-[#0052FF]" };
}

function getUrgencyStyle(urgency: string): { appearance: "gray" | "warning" | "error"; show: boolean } {
	if (urgency === "high") return { appearance: "warning", show: true };
	if (urgency === "critical") return { appearance: "error", show: true };
	return { appearance: "gray", show: false };
}

// =============================================================================
// Proposal Card
// =============================================================================

interface ProposalCardProps {
	intent: Intent;
	onSelect: (intent: Intent) => void;
}

function ProposalCard({ intent, onSelect }: ProposalCardProps) {
	const updateStatus = useUpdateIntentStatus();
	const [isRejecting, setIsRejecting] = useState(false);

	const summary = getProposalSummary(intent);
	const type = getProposalType(intent);
	const urgency = getUrgencyStyle(intent.urgency);
	const isPending = intent.status === "pending";
	const token = isTransferIntent(intent.details) ? intent.details.token : "USDC";

	const handleReject = async (e: React.MouseEvent) => {
		e.stopPropagation();
		setIsRejecting(true);
		try {
			await updateStatus.mutateAsync({ id: intent.id, status: "rejected" });
		} catch {
			// handled by query
		} finally {
			setIsRejecting(false);
		}
	};

	const handleApprove = (e: React.MouseEvent) => {
		e.stopPropagation();
		onSelect(intent);
	};

	return (
		<div
			className="group rounded-xl bg-muted-transparent hover:bg-muted-hover transition-all duration-200 cursor-pointer overflow-hidden"
			onClick={() => onSelect(intent)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") onSelect(intent);
			}}
			tabIndex={0}
			role="button"
		>
			<div className="p-20 flex flex-col gap-16">
				{/* Top row: Agent + Time + Status */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-10">
						{/* Agent avatar */}
						<div className="size-36 rounded-full bg-interactive flex items-center justify-center shrink-0">
							<span className="body-2-semi-bold text-on-interactive">
								{intent.agentName.charAt(0).toUpperCase()}
							</span>
						</div>
						<div className="flex flex-col gap-2">
							<span className="body-2-semi-bold text-base">{intent.agentName}</span>
							<span className="body-3 text-muted">{formatTimeAgo(intent.createdAt)}</span>
						</div>
					</div>
					<div className="flex items-center gap-8">
						{urgency.show && (
							<Tag
								appearance={urgency.appearance}
								size="sm"
								label={`${intent.urgency.charAt(0).toUpperCase() + intent.urgency.slice(1)}`}
							/>
						)}
						<StatusBadge status={intent.status} />
					</div>
				</div>

				{/* Type badge + Summary */}
				<div className="flex flex-col gap-8">
					<div className="flex items-center gap-8">
						<span className={`inline-block size-8 rounded-full ${type.color} shrink-0`} />
						<span className="body-3-semi-bold text-muted uppercase tracking-wide">
							{type.label}
						</span>
					</div>
					<p className="body-1 text-base">{summary}</p>
				</div>

				{/* Amount */}
				<div className="flex items-center gap-8">
					<span className="heading-3-semi-bold text-base">
						{intent.details.amount} {token}
					</span>
					{/* USDC icon inline */}
					{token === "USDC" && (
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
					)}
				</div>

				{/* Actions (only for pending) */}
				{isPending && (
					<div
						className="flex items-center gap-12 pt-4"
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
					>
						<Button
							appearance="gray"
							size="sm"
							onClick={handleReject}
							disabled={isRejecting || updateStatus.isPending}
						>
							{isRejecting ? <Spinner size="sm" /> : "Reject"}
						</Button>
						<Button
							appearance="base"
							size="sm"
							onClick={handleApprove}
							disabled={isRejecting || updateStatus.isPending}
						>
							Approve
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}

// =============================================================================
// Empty State
// =============================================================================

function EmptyState({ isConnected }: { isConnected: boolean }) {
	if (!isConnected) {
		return (
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
					<p className="body-2 text-muted mt-4">to view agent proposals</p>
				</div>
			</div>
		);
	}

	return (
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
					Your AI agents haven't submitted anything yet
				</p>
			</div>
		</div>
	);
}

// =============================================================================
// Main Component
// =============================================================================

export function IntentList() {
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

	const [selectedIntent, setSelectedIntent] = useState<Intent | null>(null);
	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const [deliberatedIds, setDeliberatedIds] = useState<Set<string>>(new Set());

	const pendingIntents = intents?.filter((i) => i.status === "pending");
	const sortedIntents = pendingIntents ? sortIntents(pendingIntents) : undefined;
	const pendingCount = pendingIntents?.length ?? 0;
	const pendingTotal = intents ? calculatePendingTotal(intents) : 0;

	const handleSelectIntent = (intent: Intent) => {
		setSelectedIntent(intent);
		setIsDialogOpen(true);
	};

	const handleDialogClose = (open: boolean) => {
		setIsDialogOpen(open);
		if (!open) {
			setTimeout(() => setSelectedIntent(null), 300);
		}
	};

	const handleCouncilComplete = (intentId: string) => {
		setDeliberatedIds((prev) => new Set(prev).add(intentId));
	};

	return (
		<div className="flex flex-col gap-16">
			{/* Stats Tiles */}
			<div className="flex gap-16">
				<div className="flex flex-1 flex-col gap-8 rounded-md bg-muted-transparent p-16">
					<span className="body-2 text-muted">Total Value</span>
					<AmountDisplay value={pendingTotal} formatter={usdcFormatter} />
				</div>
				<div className="flex flex-1 flex-col gap-8 rounded-md bg-muted-transparent p-16">
					<span className="body-2 text-muted">Pending Proposals</span>
					<div>
						<span className="heading-1-semi-bold text-base">{pendingCount}</span>
						<span className="heading-2-semi-bold text-muted">
							{" "}
							proposal{pendingCount !== 1 ? "s" : ""}
						</span>
					</div>
				</div>
			</div>

			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-12">
					<h2 className="heading-4-semi-bold text-base">Agent Proposals</h2>
					{pendingCount > 0 && (
						<span className="rounded-xs bg-warning px-8 py-4 body-3 text-warning">
							{pendingCount} pending
						</span>
					)}
				</div>
			</div>

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
					Failed to load proposals: {error.message}
				</div>
			)}

			{/* Loading */}
			{isLoading && (
				<div className="flex items-center justify-center py-48">
					<Spinner size="lg" className="text-muted" />
				</div>
			)}

			{/* Proposal Cards */}
			{!isLoading && sortedIntents && sortedIntents.length > 0 && (
				<div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
					{sortedIntents.map((intent) => (
						<ProposalCard
							key={intent.id}
							intent={intent}
							onSelect={handleSelectIntent}
						/>
					))}
				</div>
			)}

			{/* Empty State */}
			{!isLoading &&
				(!sortedIntents || sortedIntents.length === 0) &&
				authStatus === "authed" && <EmptyState isConnected={isConnected} />}

			{!isLoading && !isConnected && authStatus !== "authed" && (
				<EmptyState isConnected={false} />
			)}

			<IntentDetailDialog
				intent={selectedIntent}
				open={isDialogOpen}
				onOpenChange={handleDialogClose}
				councilAlreadyDone={selectedIntent ? deliberatedIds.has(selectedIntent.id) : false}
				onCouncilComplete={handleCouncilComplete}
			/>
		</div>
	);
}
