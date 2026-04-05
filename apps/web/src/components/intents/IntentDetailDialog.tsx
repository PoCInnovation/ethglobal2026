import type { Intent } from "@agent-intents/shared";
import * as RadixDialog from "@radix-ui/react-dialog";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
} from "@ledgerhq/lumen-ui-react";
import type { CouncilArchivedRecord } from "@/lib/councilTypes";
import { useState, useCallback, useEffect, useRef } from "react";
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

export function IntentDetailDialog({
	intent,
	open,
	onOpenChange,
	councilAlreadyDone = false,
	onCouncilComplete,
}: IntentDetailDialogProps) {
	const [councilDone, setCouncilDone] = useState(councilAlreadyDone);
	const [councilVerdict, setCouncilVerdict] = useState<{ approved: boolean } | null>(null);
	/** Snapshot from live SSE — `intent` from the client cache never includes server-only `councilResult`. */
	const [archivedCouncilRecord, setArchivedCouncilRecord] = useState<CouncilArchivedRecord | null>(null);
	// Council deliberation only starts when user clicks "Analyze"
	const [councilStarted, setCouncilStarted] = useState(false);

	/** Last intent id we synced — avoids resetting when only `councilAlreadyDone` flips (parent adds id after deliberation). */
	const councilResetIntentIdRef = useRef<string | undefined>(undefined);

	useEffect(() => {
		if (!intent?.id) {
			councilResetIntentIdRef.current = undefined;
			return;
		}
		const id = intent.id;
		// Same intent as last sync: e.g. parent set `deliberatedIds` → councilAlreadyDone true — must NOT wipe verdict / archive / panel
		if (councilResetIntentIdRef.current === id) return;
		councilResetIntentIdRef.current = id;
		setCouncilDone(councilAlreadyDone);
		setCouncilStarted(false);
		setCouncilVerdict(null);
		setArchivedCouncilRecord(null);
	}, [intent?.id, councilAlreadyDone]);

	const handleCouncilComplete = useCallback(
		(payload: { approved: boolean; ratio: number; record: CouncilArchivedRecord }) => {
			setCouncilDone(true);
			setCouncilVerdict({ approved: payload.approved });
			setArchivedCouncilRecord(payload.record);
			onCouncilComplete?.(intent?.id ?? "");
		},
		[intent?.id, onCouncilComplete],
	);

	if (!intent) return null;

	const handleClose = () => {
		onOpenChange(false);
		// Reset council state when dialog closes
		setCouncilStarted(false);
		setCouncilDone(false);
		setCouncilVerdict(null);
		setArchivedCouncilRecord(null);
	};
	const isTransfer = intent.details.type === "transfer";
	const isX402 =
		isTransfer &&
		!!(intent.details as { x402?: { accepted?: unknown } }).x402?.accepted;
	const isPolymarket = intent.details.type === "polymarket_trade";
	const isPending = intent.status === "pending";

	const dialogTitle = isPolymarket
		? "Review Polymarket Trade"
		: isX402
			? "Authorize API Payment"
			: "Review Transfer";

	// ─── Polymarket: two-panel layout with "Analyze" trigger ─────────────
	if (isPolymarket) {
		return (
			<RadixDialog.Root open={open} onOpenChange={onOpenChange}>
				<RadixDialog.Portal>
					{/* Overlay */}
					<RadixDialog.Overlay
						className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out"
					/>

					{/* Content */}
					<RadixDialog.Content
						aria-describedby={undefined}
						className="fixed left-1/2 top-1/2 z-[100] -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-48px)] max-w-[1200px] rounded-2xl overflow-hidden shadow-2xl outline-none data-[state=open]:animate-content-show data-[state=closed]:animate-content-hide"
						style={{ background: "#111113", border: "1px solid rgba(255,255,255,0.07)" }}
					>
						{/* Header bar */}
						<div
							className="flex items-center justify-between px-24 py-20 border-b"
							style={{ borderColor: "rgba(255,255,255,0.07)" }}
						>
							<div className="flex items-center gap-12">
								<span
									className="text-[11px] font-mono uppercase tracking-[0.15em]"
									style={{ color: "#4a4a55" }}
								>
									Polymarket Trade
								</span>
								<span style={{ color: "#333" }}>·</span>
								<RadixDialog.Title className="text-[14px] font-semibold text-white/80">
									{dialogTitle}
								</RadixDialog.Title>
							</div>
							<RadixDialog.Close
								className="flex items-center justify-center w-[32px] h-[32px] rounded-lg text-white/30 hover:text-white/80 hover:bg-white/5 transition-colors text-[20px] leading-none"
								aria-label="Close"
							>
								×
							</RadixDialog.Close>
						</div>

						{/* Two-panel body */}
						<div className="flex" style={{ height: "calc(100vh - 120px)", maxHeight: "820px" }}>

							{/* ── Left panel — trade info + actions ── */}
							<div
								className="w-[380px] flex-shrink-0 flex flex-col border-r overflow-hidden"
								style={{ borderColor: "rgba(255,255,255,0.07)" }}
							>
								{/* Scrollable trade details */}
								<div className="flex-1 overflow-y-auto px-16 py-16 flex flex-col gap-16" style={{ scrollbarWidth: "none" }}>
									<IntentDetailContent intent={intent} />

									{/* Verdict badge */}
									{councilVerdict && (
										<div className="flex items-center gap-8">
											<div
												className="flex items-center justify-center rounded-full flex-shrink-0"
												style={{
													width: 32,
													height: 32,
													background: councilVerdict.approved ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
												}}
											>
												{councilVerdict.approved ? (
													<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
														<path d="M2.5 7L5.5 10L11.5 4" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
													</svg>
												) : (
													<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
														<path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
													</svg>
												)}
											</div>
											<span className="text-[13px] font-medium" style={{ color: councilVerdict.approved ? "#22c55e" : "#ef4444" }}>
												{councilVerdict.approved ? "Approved by council" : "Rejected by council"}
											</span>
										</div>
									)}
								</div>

								{/* Pinned action footer */}
								<div
									className="px-16 py-14 border-t flex flex-col gap-8"
									style={{ borderColor: "rgba(255,255,255,0.07)" }}
								>
									{isPending && !councilDone && (
										<div className="flex items-center justify-center gap-6 py-4">
											<span
												className="size-[5px] rounded-full animate-pulse"
												style={{ background: "#4a90d9" }}
											/>
											<span className="text-[11px] font-mono" style={{ color: "#4a4a55" }}>
												Council deliberating…
											</span>
										</div>
									)}
									<IntentDetailContent.Actions intent={intent} onClose={handleClose} />
								</div>
							</div>

							{/* ── Right panel — council analysis ── */}
							<div
								className="flex-1 flex flex-col min-w-0 overflow-hidden"
								style={{ background: "#0d0d0f" }}
							>
								{!councilStarted ? (
									<div className="flex-1 flex flex-col items-center justify-center gap-16 px-20">
										{/* Council not started — show Analyze button */}
										<span className="text-[40px]">🧑‍⚖️</span>
										<div className="text-center">
											<p className="text-[14px] font-semibold text-white/70">
												AI Council Analysis
											</p>
											<p className="text-[12px] text-white/30 mt-4 max-w-[320px]">
												Have 3 AI agents (Analyst, Risk Manager, Contrarian) debate this market before you sign.
											</p>
										</div>
										<button
											type="button"
											onClick={() => setCouncilStarted(true)}
											className="px-24 py-12 rounded-xl text-[14px] font-bold transition-all duration-300"
											style={{
												background: "linear-gradient(135deg, #7c3aed, #2563eb)",
												color: "#fff",
												boxShadow: "0 0 20px rgba(124,58,237,0.3)",
											}}
										>
											🔍 Analyze this trade
										</button>
										<p className="text-[10px] text-white/15 text-center">
											Optional — you can sign directly without analysis
										</p>
									</div>
								) : isPending && !councilDone ? (
									<CouncilDeliberation
										intentId={intent.id}
										onComplete={handleCouncilComplete}
									/>
								) : (
									<CouncilResultReadonly
										intent={intent}
										archivedRecord={archivedCouncilRecord}
									/>
								)}
							</div>
						</div>
					</RadixDialog.Content>
				</RadixDialog.Portal>
			</RadixDialog.Root>
		);
	}

	// ─── Default: Lumen dialog for transfers / x402 ───────────────────────────
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-[540px]">
				<DialogHeader appearance="compact" title={dialogTitle} onClose={handleClose} />
				<DialogBody>
					<IntentDetailContent intent={intent} />
				</DialogBody>
				<DialogFooter>
					<IntentDetailContent.Actions intent={intent} onClose={handleClose} />
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// =============================================================================
// CouncilResultReadonly — cached council result for non-pending trades
// =============================================================================

const RIGHT_AGENTS_READONLY = new Set(["quant"]);

function CouncilResultReadonly({
	intent,
	archivedRecord,
}: {
	intent: Intent;
	archivedRecord?: CouncilArchivedRecord | null;
}) {
	const fromIntent = (intent.details as { councilResult?: CouncilArchivedRecord | undefined })
		.councilResult;
	const councilResult = archivedRecord ?? fromIntent;

	if (!councilResult) {
		return (
			<div className="flex-1 flex items-center justify-center text-[12px] font-mono" style={{ color: "#333" }}>
				No council record
			</div>
		);
	}

	const total =
		councilResult.totalFor + councilResult.totalAgainst + councilResult.totalAbstain;
	const pct = Math.round(councilResult.ratio * 100);

	return (
		<div className="flex-1 flex flex-col min-h-0">
			{/* Scrollable chat area */}
			<div className="flex-1 overflow-y-auto px-20 py-16 flex flex-col gap-12" style={{ scrollbarWidth: "none" }}>
				<span className="text-[10px] font-mono uppercase tracking-[0.15em]" style={{ color: "#4a4a55" }}>
					Council · Archived Record
				</span>

				{councilResult.agents.map((agent) => {
					const isRight = RIGHT_AGENTS_READONLY.has(agent.agentId);
					return (
						<div key={agent.agentId} className="flex flex-col gap-8">
							{agent.rounds.map((content, idx) => {
								const text = content.replace(/\n*VOTE:\s*(FOR|AGAINST)\b.*/i, "").trim();
								return (
									<div
										key={idx}
										className={`flex flex-col ${isRight ? "items-end" : "items-start"} max-w-[85%] ${isRight ? "self-end" : "self-start"}`}
									>
										{idx === 0 && (
											<div className={`flex items-baseline gap-6 mb-3 ${isRight ? "flex-row-reverse" : ""}`}>
												<span className="text-[11px] font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>
													{agent.avatar} {agent.agentName}
												</span>
												{agent.vote === "FOR" && (
													<span className="text-[10px] font-mono tracking-wider" style={{ color: "#6ee7b7" }}>FOR</span>
												)}
												{agent.vote === "AGAINST" && (
													<span className="text-[10px] font-mono tracking-wider" style={{ color: "#fca5a5" }}>AGAINST</span>
												)}
											</div>
										)}
										<div
											className="px-14 py-10"
											style={{
												background: isRight ? "#0b84fe" : "#2c2c2e",
												borderRadius: isRight ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
											}}
										>
											<p className="text-[13px] leading-[1.65] whitespace-pre-wrap" style={{ color: "#fff" }}>
												{text}
											</p>
										</div>
									</div>
								);
							})}
						</div>
					);
				})}
			</div>

			{/* Pinned bottom — verdict + summary */}
			<div className="flex-shrink-0 flex flex-col gap-10 px-20 py-12">
				{/* Verdict */}
				<div
					className="w-full rounded-xl px-20 py-14 flex items-center justify-center gap-8"
					style={{ background: councilResult.approved ? "#22c55e" : "#ef4444" }}
				>
					<span className="text-[14px] font-semibold text-white">
						{councilResult.approved ? "✓ Approved" : "✗ Rejected"}
					</span>
					<span className="text-[12px] text-white/70">
						{councilResult.totalFor}/{total} FOR · {pct}%
					</span>
				</div>

				{/* Summary — white box */}
				{councilResult.summary && (
					<div
						className="w-full rounded-xl px-20 py-14 flex items-center justify-center"
						style={{ background: "#ffffff" }}
					>
						<p className="text-[14px] font-medium text-black text-center leading-snug">
							{councilResult.summary}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
