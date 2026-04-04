/**
 * Polyledger logo — Polymarket diamond shape with a Ledger shield/lock motif.
 * Uses `currentColor` so it adapts to light/dark themes.
 */
export function AgentIntentsLogo({
	size = 32,
	className,
}: {
	size?: number;
	className?: string;
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 32 32"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
			aria-hidden="true"
		>
			{/* Polymarket-style diamond shape */}
			<path
				d="M16 2L29 16L16 30L3 16L16 2Z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinejoin="round"
			/>

			{/* Ledger shield / secure vault */}
			<path
				d="M16 9C13 9 11 10.5 11 10.5V17C11 20.5 16 23 16 23C16 23 21 20.5 21 17V10.5C21 10.5 19 9 16 9Z"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>

			{/* Checkmark inside shield — trust / verified */}
			<path
				d="M13.5 16L15.5 18L19 14"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
