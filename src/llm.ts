/**
 * LLM access: model resolution, completion calls, and the session-fork
 * machinery that lets a call replay the main session's request prefix so the
 * provider's prompt cache is reused.
 */

import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { Message, SimpleStreamOptions, Tool } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Config } from "./core.ts";

export type ResolvedModel = NonNullable<ExtensionContext["model"]>;

/**
 * A fork of the main session's last LLM request. When the prefix (tools,
 * system prompt, messages) is byte-identical to what the agent sent, the
 * provider's prompt cache is reused and the history costs cache-read prices.
 */
export interface ForkContext {
	systemPrompt: string;
	messages: Message[];
	tools?: Tool[];
	reasoning: SimpleStreamOptions["reasoning"];
}

/** The model to use for checks and translations: the configured override, else the session model. */
export function resolveModel(ctx: ExtensionContext, cfg: Config): ResolvedModel | undefined {
	if (cfg.model && cfg.model !== "default") {
		const slash = cfg.model.indexOf("/");
		if (slash > 0) {
			const found = ctx.modelRegistry.find(cfg.model.slice(0, slash), cfg.model.slice(slash + 1));
			if (found) return found;
		}
	}
	return ctx.model;
}

/** Run a single-prompt completion; with `fork`, replay the session prefix first. */
export async function runLlm(
	ctx: ExtensionContext,
	model: ResolvedModel,
	prompt: string,
	signal?: AbortSignal,
	fork?: ForkContext,
): Promise<string | undefined> {
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) return undefined;

	const user: Message = {
		role: "user",
		content: [{ type: "text" as const, text: prompt }],
		timestamp: Date.now(),
	};
	const response = await completeSimple(
		model,
		fork
			? { systemPrompt: fork.systemPrompt, messages: [...fork.messages, user], tools: fork.tools }
			: { messages: [user] },
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			env: auth.env,
			signal,
			...(fork ? { reasoning: fork.reasoning } : {}),
		},
	);

	return response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();
}

/**
 * Track the main session's LLM requests so `makeFork` can replay the exact
 * prefix of the most recent one. Returns undefined before the first request
 * (callers then fall back to a context-free call).
 */
export function createForkTracker(pi: ExtensionAPI): { makeFork(ctx: ExtensionContext): ForkContext | undefined } {
	// Messages of the main session's most recent LLM request (LLM-visible roles only).
	let sessionLlmMessages: Message[] | undefined;

	pi.on("context", (event) => {
		sessionLlmMessages = event.messages.filter(
			(m): m is Message => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
		);
	});

	/** The agent's active tool definitions, in the order the agent sends them. */
	const sessionTools = (): Tool[] | undefined => {
		const byName = new Map(pi.getAllTools().map((t) => [t.name, t]));
		const tools: Tool[] = [];
		for (const name of pi.getActiveTools()) {
			const info = byName.get(name);
			if (info) tools.push({ name: info.name, description: info.description, parameters: info.parameters });
		}
		return tools.length > 0 ? tools : undefined;
	};

	return {
		makeFork(ctx) {
			if (!sessionLlmMessages || sessionLlmMessages.length === 0) return undefined;
			// Match the session's thinking level too: on Anthropic, changing thinking
			// settings invalidates the message-level prompt cache.
			const thinking = pi.getThinkingLevel();
			return {
				systemPrompt: ctx.getSystemPrompt(),
				messages: sessionLlmMessages,
				tools: sessionTools(),
				reasoning: thinking === "off" ? undefined : thinking,
			};
		},
	};
}
