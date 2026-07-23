/**
 * Composition root: wires the feature modules to pi's extension API.
 * - src/llm.ts      — model resolution, LLM calls, session-fork tracking
 * - src/grammar.ts  — the "✏ Writing check" widget
 * - src/translate.ts — bilingual translation cards (alt+t, /translate, auto)
 * - src/settings.ts — /lang command, settings menu, status bar, warnings
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGrammarCheck } from "./grammar.ts";
import { createForkTracker } from "./llm.ts";
import { registerLangSettings } from "./settings.ts";
import { registerTranslation } from "./translate.ts";

export default function (pi: ExtensionAPI) {
	const fork = createForkTracker(pi);
	const grammar = registerGrammarCheck(pi);
	registerTranslation(pi, fork);
	registerLangSettings(pi, { disableGrammar: grammar.disable });
}
