/**
 * Entry point. The implementation lives in src/:
 * - src/core.ts      — pure logic (heuristics, prompts, parsing, card assembly)
 * - src/config.ts    — config persistence
 * - src/llm.ts       — model resolution, LLM calls, session-fork tracking
 * - src/grammar.ts   — the "✏ Writing check" widget
 * - src/translate.ts — bilingual translation cards
 * - src/settings.ts  — /lang command, settings menu, status bar
 * - src/index.ts     — composition root wiring the features together
 *
 * This file keeps the published `main`, the ~/.pi/agent/extensions symlink,
 * and test imports stable.
 */

export * from "./src/core.ts";
export { getProviderStreamSimple } from "./src/llm.ts";
export { default } from "./src/index.ts";
