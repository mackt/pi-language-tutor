/**
 * Pi adapter: wires the pure core (src/core.ts) to pi's extension API —
 * events, commands, shortcut, LLM calls, and TUI rendering. This is the only
 * file that imports pi packages.
 */

import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Container, Markdown, Text } from "@earendil-works/pi-tui";
import { loadConfig, saveConfig } from "./config.ts";
import type { CardSegment, Config, GrammarItem, Segment, TranslationCard } from "./core.ts";
import {
	buildGrammarPrompt,
	buildSegmentPrompt,
	cardMarkdown,
	extractJson,
	MAX_TRANSLATE_CHARS,
	MIN_AUTO_WORDS,
	parseGrammarResult,
	segmentMarkdown,
	SHORT_CODE_LINES,
	shouldSkipCheck,
	translationLabel,
} from "./core.ts";

type ResolvedModel = NonNullable<ExtensionContext["model"]>;

const WIDGET_KEY = "language-learn";
const STATUS_KEY = "language-learn";
const ENTRY_TYPE = "lang-translation";

function resolveModel(ctx: ExtensionContext, cfg: Config): ResolvedModel | undefined {
	if (cfg.model && cfg.model !== "default") {
		const slash = cfg.model.indexOf("/");
		if (slash > 0) {
			const found = ctx.modelRegistry.find(cfg.model.slice(0, slash), cfg.model.slice(slash + 1));
			if (found) return found;
		}
	}
	return ctx.model;
}

async function runLlm(
	ctx: ExtensionContext,
	model: ResolvedModel,
	prompt: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) return undefined;

	const response = await complete(
		model,
		{
			messages: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: prompt }],
					timestamp: Date.now(),
				},
			],
		},
		{ apiKey: auth.apiKey, headers: auth.headers, env: auth.env, signal },
	);

	return response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();
}

function showGrammarWidget(ctx: ExtensionContext, items: GrammarItem[], rephrase: string | undefined): void {
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

export default function (pi: ExtensionAPI) {
	let grammarAbort: AbortController | undefined;
	let lastAutoKey: string | undefined;

	const updateStatus = (ctx: ExtensionContext, cfg: Config) => {
		if (!ctx.hasUI) return;
		const parts: string[] = [];
		if (!cfg.enabled) parts.push("✏ lang off");
		if (cfg.auto) parts.push("🌐 auto");
		ctx.ui.setStatus(STATUS_KEY, parts.length > 0 ? parts.join("  ") : undefined);
	};

	const runGrammarCheck = async (text: string, cfg: Config, ctx: ExtensionContext, signal: AbortSignal) => {
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
				showGrammarWidget(ctx, items.slice(0, 5), rephrase);
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

		grammarAbort?.abort();
		grammarAbort = new AbortController();
		// Fire and forget: the message continues to the agent immediately.
		void runGrammarCheck(text, cfg, ctx, grammarAbort.signal);
	});

	// -------------------------------------------------------------------------
	// Translation
	// -------------------------------------------------------------------------

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
	): Promise<CardSegment[] | undefined> => {
		const segments = segmentMarkdown(source);
		const prose = segments.filter((s): s is Segment & { kind: "prose" } => s.kind === "prose");
		if (prose.length === 0) return undefined;

		const raw = await runLlm(ctx, model, buildSegmentPrompt(prose.map((p) => p.text), cfg), ctx.signal);
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
			const segments = await buildBilingualSegments(clipped, cfg, ctx, model);
			if (segments) {
				pi.appendEntry<TranslationCard>(ENTRY_TYPE, { native: cfg.native, segments });
				return;
			}

			// Fallback: whole-text translation as a plain card.
			const prompt = [
				`Translate the following AI coding assistant response into ${cfg.native}.`,
				`Keep code blocks, inline code, file paths, commands, and technical identifiers exactly as-is (untranslated).`,
				`Preserve the markdown structure. Output ONLY the translation.`,
				``,
				`<<<`,
				clipped,
				`>>>`,
			].join("\n");
			const translated = await runLlm(ctx, model, prompt, ctx.signal);
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

	// -------------------------------------------------------------------------
	// /lang settings command
	// -------------------------------------------------------------------------

	pi.registerCommand("lang", {
		description:
			"Language learning: /lang [on|off|auto on|off|native <code>|learning <code>|model <provider/id|default>]",
		handler: async (args, ctx) => {
			const cfg = loadConfig();
			const [sub, value] = args.trim().split(/\s+/, 2);

			const show = () =>
				ctx.ui.notify(
					`learning=${cfg.learning}  native=${cfg.native}  model=${cfg.model ?? "default (session model)"}  check=${cfg.enabled ? "on" : "off"}  auto=${cfg.auto ? "on" : "off"}`,
					"info",
				);

			switch (sub ?? "") {
				case "":
					show();
					return;
				case "on":
				case "off":
					cfg.enabled = sub === "on";
					if (!cfg.enabled) {
						grammarAbort?.abort();
						ctx.ui.setWidget(WIDGET_KEY, undefined);
					}
					break;
				case "auto":
					if (value !== "on" && value !== "off") {
						ctx.ui.notify("Usage: /lang auto on|off", "warning");
						return;
					}
					cfg.auto = value === "on";
					if (cfg.auto && !cfg.model) {
						ctx.ui.notify(
							"auto mode uses the session model — consider a cheaper one, e.g. /lang model anthropic/claude-haiku-4-5",
							"info",
						);
					}
					break;
				case "native":
				case "learning":
					if (!value) {
						ctx.ui.notify(`Usage: /lang ${sub} <language code, e.g. en, zh-CN, ja>`, "warning");
						return;
					}
					cfg[sub as "native" | "learning"] = value;
					break;
				case "model":
					if (!value) {
						ctx.ui.notify("Usage: /lang model <provider/id> or /lang model default", "warning");
						return;
					}
					if (value === "default") {
						cfg.model = undefined;
					} else {
						const slash = value.indexOf("/");
						const found =
							slash > 0 ? ctx.modelRegistry.find(value.slice(0, slash), value.slice(slash + 1)) : undefined;
						if (!found) {
							ctx.ui.notify(`Model not found: ${value} (expected <provider>/<id>)`, "warning");
							return;
						}
						cfg.model = value;
					}
					break;
				default:
					ctx.ui.notify(
						"Usage: /lang [on|off|auto on|off|native <code>|learning <code>|model <provider/id|default>]",
						"warning",
					);
					return;
			}

			saveConfig(cfg);
			updateStatus(ctx, cfg);
			show();
		},
	});

	pi.on("session_start", (_event, ctx) => {
		updateStatus(ctx, loadConfig());
	});
}
