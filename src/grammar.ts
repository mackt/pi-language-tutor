/**
 * Writing check: watches interactive input and renders the "✏ Writing check"
 * widget above the editor. Non-blocking by design — the message reaches the
 * agent immediately and a failed check never disturbs the session.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { loadConfig } from "./config.ts";
import type { Config, GrammarItem } from "./core.ts";
import { buildGrammarPrompt, parseGrammarResult, shouldSkipCheck } from "./core.ts";
import { resolveModel, runLlm } from "./llm.ts";

const WIDGET_KEY = "language-learn";

function showWidget(ctx: ExtensionContext, items: GrammarItem[], rephrase: string | undefined): void {
	ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => {
		const container = new Container();
		container.addChild(new Text(theme.fg("accent", theme.bold("✏ Writing check")), 1, 0));
		for (const item of items) {
			const line = `${theme.fg("error", `"${item.wrong}"`)} → ${theme.fg("success", `"${item.right}"`)}  ${theme.fg("dim", item.reason)}`;
			container.addChild(new Text(line, 1, 0));
		}
		if (rephrase) {
			container.addChild(new Text(`${theme.fg("dim", "◇")} ${theme.fg("muted", rephrase)}`, 1, 0));
		}
		return container;
	});
}

/** Wire up the writing check. Returns `disable` for the settings toggle to call. */
export function registerGrammarCheck(pi: ExtensionAPI): { disable(ctx: ExtensionContext): void } {
	let abort: AbortController | undefined;

	const runCheck = async (text: string, cfg: Config, ctx: ExtensionContext, signal: AbortSignal) => {
		try {
			const model = resolveModel(ctx, cfg);
			if (!model) return;

			const raw = await runLlm(ctx, model, buildGrammarPrompt(text, cfg), signal);
			if (signal.aborted || raw === undefined) return;

			const result = parseGrammarResult(raw);
			const items = result?.skip ? [] : (result?.items ?? []).filter((i) => i && i.wrong && i.right);
			const rephrase =
				!result?.skip && typeof result?.rephrase === "string" && result.rephrase.trim().length > 0
					? result.rephrase.trim()
					: undefined;

			if (items.length === 0 && !rephrase) {
				ctx.ui.setWidget(WIDGET_KEY, undefined);
			} else {
				showWidget(ctx, items.slice(0, 5), rephrase);
			}
		} catch {
			// silent by design: a failed check must never disturb the session
		}
	};

	pi.on("input", (event, ctx) => {
		if (event.source !== "interactive") return;
		if (!ctx.hasUI || ctx.mode !== "tui") return;

		const cfg = loadConfig();
		if (!cfg.enabled) return;

		const text = event.text.trim();
		if (shouldSkipCheck(text)) return;

		abort?.abort();
		abort = new AbortController();
		// Fire and forget: the message continues to the agent immediately.
		void runCheck(text, cfg, ctx, abort.signal);
	});

	return {
		disable(ctx) {
			abort?.abort();
			ctx.ui.setWidget(WIDGET_KEY, undefined);
		},
	};
}
