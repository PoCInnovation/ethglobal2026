/**
 * Single place to build the OpenAI SDK client so Gemini never hits api.openai.com by mistake.
 *
 * - GEMINI_API_KEY  → baseURL MUST be Google’s OpenAI-compatible endpoint
 * - OPENAI_API_KEY  → default OpenAI cloud (no custom baseURL)
 *
 * @see https://ai.google.dev/gemini-api/docs/openai
 */

import OpenAI from "openai";

/** Trailing slash matches Google’s examples and avoids path join bugs in the SDK. */
export const GEMINI_OPENAI_COMPAT_BASE_URL =
	(process.env.GEMINI_OPENAI_BASE_URL?.trim().replace(/\/?$/, "") ||
		"https://generativelanguage.googleapis.com/v1beta/openai") + "/";

export function createLlmOpenAIClient(): OpenAI {
	const geminiKey = process.env.GEMINI_API_KEY?.trim();
	const openaiKey = process.env.OPENAI_API_KEY?.trim();

	if (geminiKey) {
		console.log(
			`[LLM] OpenAI SDK → Gemini compat (baseURL=${GEMINI_OPENAI_COMPAT_BASE_URL})`,
		);
		return new OpenAI({
			apiKey: geminiKey,
			baseURL: GEMINI_OPENAI_COMPAT_BASE_URL,
		});
	}

	if (openaiKey) {
		console.log("[LLM] OpenAI SDK → api.openai.com (default baseURL)");
		return new OpenAI({ apiKey: openaiKey });
	}

	throw new Error(
		"Set GEMINI_API_KEY (Gemini via OpenAI-compatible API) or OPENAI_API_KEY (OpenAI).",
	);
}

/** Respects LLM_MODEL; otherwise picks a sensible default per provider. */
export function defaultLlmModel(): string {
	const override = process.env.LLM_MODEL?.trim();
	if (override) return override;
	if (process.env.GEMINI_API_KEY?.trim()) return "gemini-2.5-flash";
	return "gpt-4o";
}
