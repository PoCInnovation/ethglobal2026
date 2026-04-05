import { IntentDetailContent } from "@/components/intents/IntentDetailContent";
import { CouncilDeliberation } from "@/components/council/CouncilDeliberation";
import type { CouncilCompletePayload } from "@/lib/councilTypes";
import { Spinner } from "@/components/ui/Spinner";
import { useLedger } from "@/lib/ledger-provider";
import { useWalletAuth } from "@/lib/wallet-auth";
import { intentQueryOptions } from "@/queries/intents";
import { Button } from "@ledgerhq/lumen-ui-react";
import { Devices } from "@ledgerhq/lumen-ui-react/symbols";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/pay/$intentId")({
	component: PayPage,
	head: () => ({
		meta: [{ title: "Review Payment — Agent Payments with Ledger" }],
	}),
});

function PayPage() {
	const { intentId } = Route.useParams();
	const { isConnected, isConnecting, openLedgerModal, account } = useLedger();
	const { status: authStatus, error: authError } = useWalletAuth();

	const {
		data: intent,
		isLoading,
		error,
	} = useQuery({
		...intentQueryOptions(intentId),
		// Poll pending intents so the page updates when status changes
		refetchInterval: (query) => {
			const status = query.state.data?.status;
			if (status === "pending" || status === "approved") return 5000;
			return false;
		},
	});

	// Check if the connected wallet owns this intent
	const isOwner =
		isConnected &&
		account &&
		intent?.userId &&
		account.toLowerCase() === intent.userId.toLowerCase();

	const isPending = intent?.status === "pending";
	const isTransfer = intent?.details.type === "transfer";
	const isPolymarket = intent?.details.type === "polymarket_trade";
	const isX402 = isTransfer && !!(intent?.details as { x402?: { accepted?: unknown } })?.x402?.accepted;

	// Council deliberation state for Polymarket trades
	const [councilResult, setCouncilResult] = useState<CouncilCompletePayload | null>(null);
	const councilDone = councilResult !== null;
	const councilDeliberating = isPolymarket && isPending && !councilDone;

	return (
		<div className="flex flex-col items-center gap-32">
			{/* Page header */}
			<div className="flex flex-col items-center gap-8">
				<h1 className="heading-2-semi-bold text-base">Review Payment</h1>
				<p className="body-1 text-muted">An agent is requesting your approval</p>
			</div>

			{/* Content area — constrained width, centered */}
			<div className="w-full max-w-[540px]">
				{/* Loading state */}
				{isLoading && (
					<div className="flex flex-col items-center gap-16 py-64">
						<Spinner size="lg" />
						<p className="body-1 text-muted">Loading payment details…</p>
					</div>
				)}

				{/* Error state */}
				{error && (
					<div className="flex flex-col items-center gap-16 py-64">
						<div className="flex flex-col items-center gap-8">
							<h2 className="heading-3-semi-bold text-base">Payment not found</h2>
							<p className="body-1 text-muted text-center">
								This payment link may have expired or doesn't exist.
							</p>
						</div>
						<Link to="/">
							<Button appearance="gray" size="md">
								Go to Dashboard
							</Button>
						</Link>
					</div>
				)}

				{/* Intent loaded */}
				{intent && (
					<div className="flex flex-col gap-24">
						{/* Card with intent details */}
						<div className="rounded-lg border border-muted-subtle bg-surface p-24 shadow-md">
							<IntentDetailContent intent={intent} />
						</div>

						{/* Council deliberation for Polymarket trades */}
						{isPolymarket && isPending && (
							<div className="rounded-lg border border-muted-subtle bg-surface p-24 shadow-md">
								<CouncilDeliberation
									intentId={intentId}
									onComplete={setCouncilResult}
								/>
							</div>
						)}

						{/* Council verdict indicator */}
						{councilDone && (
							<div
								className={`rounded-lg px-16 py-12 body-2 text-center ${
									councilResult.approved
										? "bg-success/10 text-success"
										: "bg-warning-transparent text-warning"
								}`}
							>
								{councilResult.approved
									? `Council approves this trade (${Math.round(councilResult.ratio * 100)}% FOR)`
									: `Council recommends against this trade (${Math.round(councilResult.ratio * 100)}% FOR) — you can still proceed`}
							</div>
						)}

						{/* Action area for pending intents */}
						{isPending && (
							<div className="flex flex-col gap-16">
								{!isConnected ? (
									<div className="flex flex-col items-center gap-16 rounded-lg bg-muted-transparent p-24">
										<div className="flex flex-col items-center gap-8">
											<h3 className="heading-5-semi-bold text-base">
												Connect your Ledger to {isX402 ? "authorize" : isPolymarket ? "confirm trade" : "sign"}
											</h3>
											<p className="body-2 text-muted text-center">
												This payment requires your hardware wallet signature.
											</p>
										</div>
										<Button
											appearance="accent"
											size="md"
											icon={Devices}
											onClick={openLedgerModal}
											disabled={isConnecting}
											loading={isConnecting}
										>
											Connect Ledger
										</Button>
									</div>
								) : !isOwner ? (
									<div className="rounded-lg bg-warning-transparent px-16 py-12 body-2 text-warning text-center">
										This payment is for a different wallet. Please connect the correct Ledger
										device.
									</div>
								) : authStatus !== "authed" ? (
									<div className="flex flex-col items-center gap-8 py-12">
										<div className="flex items-center gap-8">
											<Spinner size="sm" />
											<span className="body-2 text-muted">
												{authStatus === "checking"
													? "Checking session…"
													: authStatus === "error"
														? "Retrying authentication…"
														: "Authenticating…"}
											</span>
										</div>
										{authStatus === "error" && authError && (
											<span className="body-3 text-muted-subtle">{authError.message}</span>
										)}
									</div>
								) : (
									<div className="rounded-lg border border-muted-subtle bg-surface p-16">
										{councilDeliberating ? (
											<div className="flex items-center justify-center gap-8 py-8">
												<Spinner size="sm" />
												<span className="body-2 text-muted">
													Council is deliberating...
												</span>
											</div>
										) : (
											<IntentDetailContent.Actions
												intent={intent}
												onClose={() => {
													// After action, the query will refetch and show updated status
												}}
											/>
										)}
									</div>
								)}
							</div>
						)}

						{/* Non-pending status message */}
						{!isPending && (
							<div className="text-center">
								<p className="body-2 text-muted">
									This payment has already been{" "}
									{intent.status === "confirmed"
										? "confirmed"
										: intent.status === "rejected"
											? "rejected"
											: intent.status === "authorized"
												? "authorized"
												: intent.status === "expired"
													? "expired"
													: "processed"}
									.
								</p>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
