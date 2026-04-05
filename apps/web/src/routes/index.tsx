import { HistoryList, IntentList } from "@/components/intents";
import { cn } from "@/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/")({
	component: HomePage,
});

type Tab = "pending" | "history";

function HomePage() {
	const [activeTab, setActiveTab] = useState<Tab>("pending");

	return (
		<div className="flex flex-col gap-24">
			{/* Tabs */}
			<div className="flex items-center gap-4 border-b border-muted">
				<TabButton
					active={activeTab === "pending"}
					onClick={() => setActiveTab("pending")}
				>
					Pending
				</TabButton>
				<TabButton
					active={activeTab === "history"}
					onClick={() => setActiveTab("history")}
				>
					History
				</TabButton>
			</div>

			{/* Tab content */}
			{activeTab === "pending" && <IntentList />}
			{activeTab === "history" && <HistoryList />}
		</div>
	);
}

function TabButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"px-16 py-12 body-2-semi-bold transition-colors relative",
				active
					? "text-base"
					: "text-muted hover:text-base",
			)}
		>
			{children}
			{active && (
				<span className="absolute bottom-0 left-0 right-0 h-2 bg-interactive rounded-t-full" />
			)}
		</button>
	);
}
