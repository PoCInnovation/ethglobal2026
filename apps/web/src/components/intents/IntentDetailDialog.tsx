import type { Intent } from "@agent-intents/shared";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
} from "@ledgerhq/lumen-ui-react";
import { useState, useCallback } from "react";
import { CouncilDeliberation } from "@/components/council/CouncilDeliberation";
import { IntentDetailContent } from "./IntentDetailContent";

// =============================================================================
// Types
// =============================================================================

interface IntentDetailDialogProps {
	intent: Intent | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	councilAlreadyDone?: boolean;
	onCouncilComplete?: (intentId: string) => void;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Dialog wrapper for displaying intent details for approval.
 * Uses Lumen Dialog components with controlled open state.
 */
export function IntentDetailDialog({ intent, open, onOpenChange, councilAlreadyDone = false, onCouncilComplete }: IntentDetailDialogProps) {
	const [councilDone, setCouncilDone] = useState(councilAlreadyDone);
	const handleCouncilComplete = useCallback(() => {
		setCouncilDone(true);
		onCouncilComplete?.(intent?.id ?? "");
	}, [intent?.id, onCouncilComplete]);

	if (!intent) return null;

	const handleClose = () => onOpenChange(false);
	const isTransfer = intent.details.type === "transfer";
	const isX402 = isTransfer && !!(intent.details as { x402?: { accepted?: unknown } }).x402?.accepted;
	const isPolymarket = intent.details.type === "polymarket_trade";
	const isPending = intent.status === "pending";
	const dialogTitle = isPolymarket
		? "Review Polymarket Trade"
		: isX402
			? "Authorize API Payment"
			: "Review Transfer";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-[540px]">
				<DialogHeader appearance="compact" title={dialogTitle} onClose={handleClose} />
				<DialogBody>
					<IntentDetailContent intent={intent} />
					{isPolymarket && isPending && (
						<div className="mt-16">
							<CouncilDeliberation
								intentId={intent.id}
								onComplete={handleCouncilComplete}
							/>
						</div>
					)}
				</DialogBody>
				<DialogFooter>
					{isPolymarket && isPending && !councilDone ? (
						<div className="flex items-center justify-center gap-8 py-8 w-full body-2 text-muted">
							Waiting for council deliberation…
						</div>
					) : (
						<IntentDetailContent.Actions intent={intent} onClose={handleClose} />
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
