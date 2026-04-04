import { IntentList } from "@/components/intents";
import { TestPolymarketOrder } from "@/components/TestPolymarketOrder";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/")({
	component: HomePage,
});

const API_BASE = "";

function HomePage() {
	const [scanning, setScanning] = useState(false);

	const handleScanNow = async () => {
		setScanning(true);
		try {
			await fetch(`${API_BASE}/api/polymarket/scan-now`, { method: "POST" });
			// Refresh the page to show new intents
			window.location.reload();
		} catch {
			// ignore
		} finally {
			setScanning(false);
		}
	};

	return (
		<div className="flex flex-col gap-32">
			{/* Page header */}
			<div className="flex items-center justify-between">
				<div className="flex flex-col gap-8">
					<h1 className="heading-1-semi-bold text-base">Agent Payments with Ledger</h1>
					<p className="body-1 text-muted">Agents propose, humans sign with hardware</p>
				</div>
				<button
					type="button"
					onClick={handleScanNow}
					disabled={scanning}
					className="px-16 py-10 rounded-xl text-[13px] font-semibold transition-all duration-200"
					style={{
						background: scanning ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #7c3aed, #2563eb)",
						color: "#fff",
						cursor: scanning ? "not-allowed" : "pointer",
					}}
				>
					{scanning ? "Scanning…" : "🔍 Scan Markets"}
				</button>
			</div>

			{/* Test Polymarket signing (dev only) */}
			<TestPolymarketOrder />

			{/* Intent List (handles all states internally) */}
			<IntentList />
		</div>
	);
}
