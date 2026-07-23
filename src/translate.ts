/**
 * Translation: renders assistant responses as bilingual cards (alt+t,
 * /translate, and auto mode). Cards are custom entries — never sent back to
 * the LLM, costing no context.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { loadConfig } from "./config.ts";
import type { CardSegment, Config, Segment, TranslationCard } from "./core.ts";
import {
	buildSegmentPrompt,
	buildWholeTranslatePrompt,
	cardMarkdown,
	extractJson,
	MAX_TRANSLATE_CHARS,
	MIN_AUTO_WORDS,
	segmentMarkdown,
	SHORT_CODE_LINES,
	translationLabel,
} from "./core.ts";
import type { ForkContext, ResolvedModel } from "./llm.ts";
import { resolveModel, runLlm } from "./llm.ts";
import { STATUS_KEY, updateStatus } from "./settings.ts";

const ENTRY_TYPE = "lang-translation";

export interface TranslateDeps {
	/** Fork of the main session's last LLM request, for context mode. */
	makeFork(ctx: ExtensionContext): ForkContext | undefined;
}

/** Wire up bilingual translation: entry renderer, alt+t, /translate, and auto mode. */
export function registerTranslation(pi: ExtensionAPI, deps: TranslateDeps): void {
	let lastAutoKey: string | undefined;

	pi.registerEntryRenderer<TranslationCard>(ENTRY_TYPE, (entry, _options, theme) => {
		const data = entry.data;
		if (!data) return undefined;
		const markdown = data.segments ? cardMarkdown(data.segments) : data.text;
		if (!markdown) return undefined;
		const box = new Box(1, 0, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Text(theme.fg("accent", theme.bold(`🌐 ${translationLabel(data.native)}`)), 0, 0));
		box.addChild(new Markdown(markdown, 0, 0, getMarkdownTheme()));
		return box;
	});

	const lastAssistantText = (ctx: ExtensionContext): string | undefined => {
		const branch = ctx.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i] as { type: string; message?: { role?: string; content?: unknown } };
			if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
			const content = entry.message.content;
			if (!Array.isArray(content)) continue;
			const text = content
				.filter((c): c is { type: "text"; text: string } => c?.type === "text" && typeof c.text === "string")
				.map((c) => c.text)
				.join("\n")
				.trim();
			if (text.length > 0) return text;
		}
		return undefined;
	};

	const buildBilingualSegments = async (
		source: string,
		cfg: Config,
		ctx: ExtensionContext,
		model: ResolvedModel,
		fork?: ForkContext,
	): Promise<CardSegment[] | undefined> => {
		const segments = segmentMarkdown(source);
		const prose = segments.filter((s): s is Segment & { kind: "prose" } => s.kind === "prose");
		if (prose.length === 0) return undefined;

		const raw = await runLlm(ctx, model, buildSegmentPrompt(prose.map((p) => p.text), cfg, !!fork), ctx.signal, fork);
		if (raw === undefined) return undefined;
		const translations = extractJson<{ t?: unknown }>(raw)?.t;
		if (
			!Array.isArray(translations) ||
			translations.length !== prose.length ||
			!translations.every((t) => typeof t === "string")
		) {
			return undefined;
		}

		let proseIndex = 0;
		return segments.map((s): CardSegment => {
			if (s.kind === "prose") {
				return { kind: "pair", src: s.text, dst: (translations[proseIndex++] as string).trim() };
			}
			return s.lines <= SHORT_CODE_LINES ? { kind: "code", text: s.text } : { kind: "codeRef", lines: s.lines };
		});
	};

	const translateLast = async (ctx: ExtensionContext, opts?: { auto?: boolean }) => {
		if (!ctx.hasUI) return;
		const cfg = loadConfig();
		const notify = (msg: string) => {
			if (!opts?.auto) ctx.ui.notify(msg, "warning");
		};

		const source = lastAssistantText(ctx);
		if (!source) {
			notify("No assistant message to translate");
			return;
		}

		const model = resolveModel(ctx, cfg);
		if (!model) {
			notify("No model available for translation (set one with /lang model)");
			return;
		}

		ctx.ui.setStatus(STATUS_KEY, "🌐 translating…");
		try {
			const clipped = source.slice(0, MAX_TRANSLATE_CHARS);
			const fork = cfg.context ? deps.makeFork(ctx) : undefined;
			const segments = await buildBilingualSegments(clipped, cfg, ctx, model, fork);
			if (segments) {
				pi.appendEntry<TranslationCard>(ENTRY_TYPE, { native: cfg.native, segments });
				return;
			}

			// Fallback: whole-text translation as a plain card.
			const translated = await runLlm(ctx, model, buildWholeTranslatePrompt(clipped, cfg, !!fork), ctx.signal, fork);
			if (translated) {
				pi.appendEntry<TranslationCard>(ENTRY_TYPE, { native: cfg.native, text: translated });
			} else {
				notify(`Translation failed (no API key for ${model.provider}/${model.id}?)`);
			}
		} catch {
			notify("Translation failed");
		} finally {
			updateStatus(ctx, cfg);
		}
	};

	pi.registerShortcut("alt+t", {
		description: "Translate the last assistant response",
		handler: (ctx) => translateLast(ctx),
	});

	pi.registerCommand("translate", {
		description: "Translate the last assistant response into your native language",
		handler: async (_args, ctx) => translateLast(ctx),
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		const cfg = loadConfig();
		if (!cfg.auto) return;

		const text = lastAssistantText(ctx);
		if (!text || text.split(/\s+/).filter(Boolean).length < MIN_AUTO_WORDS) return;

		const key = text.slice(0, 200);
		if (key === lastAutoKey) return;
		lastAutoKey = key;

		void translateLast(ctx, { auto: true });
	});
}
