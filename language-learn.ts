/**
 * Entry point. The implementation lives in src/:
 * - src/core.ts   — pure logic (heuristics, prompts, parsing, card assembly)
 * - src/config.ts — config persistence
 * - src/index.ts  — pi adapter (events, commands, UI)
 *
 * This file keeps the published `main`, the ~/.pi/agent/extensions symlink,
 * and test imports stable.
 */

export * from "./src/core.ts";
export { default } from "./src/index.ts";
