import type { PolymarketTradeDetails } from "@agent-intents/shared";
import { Tag } from "@ledgerhq/lumen-ui-react";

interface PolymarketIntentDetailProps {
	details: PolymarketTradeDetails;
	/** When true, price and shares steppers are shown. */
	editable?: boolean;
	polyPrice?: number;
	polyShares?: number;
	polyAmount?: string;
	onPriceChange?: (price: number) => void;
	onSharesChange?: (shares: number) => void;
}

function Stepper({
	value,
	onChange,
	onDecrement,
	onIncrement,
	disableDecrement,
	suffix,
	min,
	max,
	step,
	integer,
}: {
	value: number;
	onChange: (v: number) => void;
	onDecrement: () => void;
	onIncrement: () => void;
	disableDecrement?: boolean;
	suffix?: string;
	min?: number;
	max?: number;
	step?: number;
	integer?: boolean;
}) {
	const displayValue = integer ? String(value) : value.toFixed(2);

	return (
		<div className="flex items-center gap-0 rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
			<button
				type="button"
				onClick={onDecrement}
				disabled={disableDecrement}
				className="flex items-center justify-center w-[28px] h-[28px] text-white/60 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-[14px] font-bold"
			>
				−
			</button>
			<div
				className="flex items-center justify-center h-[28px]"
				style={{ borderLeft: "1px solid rgba(255,255,255,0.12)", borderRight: "1px solid rgba(255,255,255,0.12)" }}
			>
				<input
					type="number"
					inputMode={integer ? "numeric" : "decimal"}
					min={min}
					max={max}
					step={step ?? (integer ? 1 : 0.01)}
					defaultValue={displayValue}
					key={displayValue}
					onBlur={(e) => {
						let v = Number.parseFloat(e.target.value);
						if (!Number.isFinite(v)) v = value;
						if (integer) v = Math.round(v);
						if (min != null) v = Math.max(min, v);
						if (max != null) v = Math.min(max, v);
						if (!integer) v = Math.round(v * 100) / 100;
						onChange(v);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") (e.target as HTMLInputElement).blur();
					}}
					className="w-[56px] h-[28px] text-center bg-transparent text-white body-2-semi-bold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				/>
				{suffix && <span className="text-white/40 body-3 pr-6 select-none">{suffix}</span>}
			</div>
			<button
				type="button"
				onClick={onIncrement}
				className="flex items-center justify-center w-[28px] h-[28px] text-white/60 hover:text-white hover:bg-white/10 transition-colors text-[14px] font-bold"
			>
				+
			</button>
		</div>
	);
}

export function PolymarketIntentDetail({
	details,
	editable,
	polyPrice = 0,
	polyShares = 0,
	polyAmount,
	onPriceChange,
	onSharesChange,
}: PolymarketIntentDetailProps) {
	const priceDisplay =
		details.outcomePrice != null ? `${(details.outcomePrice * 100).toFixed(1)}%` : "—";

	const isEditable = editable && onPriceChange && onSharesChange;

	const handlePriceUp = () => {
		const next = Math.min(0.99, Math.round((polyPrice + 0.01) * 100) / 100);
		onPriceChange?.(next);
	};
	const handlePriceDown = () => {
		const next = Math.max(0.01, Math.round((polyPrice - 0.01) * 100) / 100);
		onPriceChange?.(next);
	};
	const handleSharesUp = () => {
		onSharesChange?.(polyShares + 1);
	};
	const handleSharesDown = () => {
		onSharesChange?.(Math.max(5, polyShares - 1));
	};

	return (
		<div className="rounded-lg bg-muted-transparent p-16 flex flex-col gap-12">
			{/* Market title */}
			<div className="flex flex-col gap-4">
				<span className="body-3 text-muted">Market</span>
				<span className="body-1-semi-bold text-base">{details.marketTitle || "Loading..."}</span>
			</div>

			{/* Outcome + market price */}
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
					<span className="body-3 text-muted">Market</span>
					<span className="body-2-semi-bold text-base">{priceDisplay}</span>
				</div>
			</div>

			{isEditable ? (
				<>
					{/* Price per share stepper */}
					<div className="flex items-center justify-between">
						<span className="body-3 text-muted">Price / share</span>
						<Stepper
							value={polyPrice}
							onChange={(v) => onPriceChange?.(v)}
							onDecrement={handlePriceDown}
							onIncrement={handlePriceUp}
							disableDecrement={polyPrice <= 0.01}
							suffix="$"
							min={0.01}
							max={0.99}
							step={0.01}
						/>
					</div>

					{/* Shares stepper */}
					<div className="flex items-center justify-between">
						<span className="body-3 text-muted">Shares</span>
						<Stepper
							value={polyShares}
							onChange={(v) => onSharesChange?.(v)}
							onDecrement={handleSharesDown}
							onIncrement={handleSharesUp}
							disableDecrement={polyShares <= 5}
							min={5}
							integer
						/>
					</div>

					{/* Computed total */}
					<div className="flex items-center justify-between border-t border-muted-subtle pt-8">
						<span className="body-3 text-muted">Total</span>
						<span className="body-2-semi-bold text-base">{polyAmount} USDC</span>
					</div>
				</>
			) : (
				/* Static amount */
				<div className="flex items-center justify-between">
					<span className="body-3 text-muted">Amount</span>
					<span className="body-2-semi-bold text-base">{polyAmount ?? details.amount} USDC</span>
				</div>
			)}

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
