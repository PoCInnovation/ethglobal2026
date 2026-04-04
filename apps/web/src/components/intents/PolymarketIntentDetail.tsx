import type { PolymarketTradeDetails } from "@agent-intents/shared";
import { Tag } from "@ledgerhq/lumen-ui-react";

interface PolymarketIntentDetailProps {
	details: PolymarketTradeDetails;
}

export function PolymarketIntentDetail({ details }: PolymarketIntentDetailProps) {
	const priceDisplay =
		details.outcomePrice != null ? `${(details.outcomePrice * 100).toFixed(1)}%` : "—";

	return (
		<div className="rounded-lg bg-muted-transparent p-16 flex flex-col gap-12">
			{/* Market title */}
			<div className="flex flex-col gap-4">
				<span className="body-3 text-muted">Market</span>
				<span className="body-1-semi-bold text-base">{details.marketTitle || "Loading..."}</span>
			</div>

			{/* Outcome + price */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-8">
					<span className="body-3 text-muted">Outcome</span>
					<Tag
						appearance={details.outcome === "Yes" ? "success" : "error"}
						size="sm"
						label={details.outcome}
					/>
				</div>
				<div className="flex items-center gap-4">
					<span className="body-3 text-muted">Price</span>
					<span className="body-2-semi-bold text-base">{priceDisplay}</span>
				</div>
			</div>

			{/* Amount */}
			<div className="flex items-center justify-between">
				<span className="body-3 text-muted">Amount</span>
				<span className="body-2-semi-bold text-base">{details.amount} USDC</span>
			</div>

			{/* Memo / agent justification */}
			{details.memo && (
				<div className="border-t border-muted-subtle pt-12">
					<span className="body-3 text-muted mb-4 block">Agent Justification</span>
					<p className="body-2 text-muted italic">"{details.memo}"</p>
				</div>
			)}
		</div>
	);
}
