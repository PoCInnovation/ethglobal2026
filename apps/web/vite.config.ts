import path from "node:path";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
	const env = loadEnv(mode, __dirname, "");

	return {
		plugins: [TanStackRouterVite(), react()],
		build: {
			sourcemap: command === "build" ? "hidden" : true,
		},
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src"),
				// Use workspace source so dev never serves stale `dist/` (e.g. missing POLYMARKET_CONFIG)
				"@agent-intents/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
			},
		},
		server: {
			proxy: {
				"/api": {
					target: "http://localhost:3005",
					changeOrigin: true,
				},
			},
		},
	};
});
