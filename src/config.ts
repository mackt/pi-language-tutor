/**
 * Config persistence: ~/.pi/agent/language-learn.json.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Config } from "./core.ts";

const CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "language-learn.json");

export const DEFAULT_CONFIG: Config = { learning: "en", native: "zh-CN", enabled: true, auto: false, context: false };

export function loadConfig(): Config {
	try {
		const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Partial<Config>;
		return {
			learning: typeof raw.learning === "string" ? raw.learning : DEFAULT_CONFIG.learning,
			native: typeof raw.native === "string" ? raw.native : DEFAULT_CONFIG.native,
			model: typeof raw.model === "string" ? raw.model : undefined,
			enabled: raw.enabled !== false,
			auto: raw.auto === true,
			context: raw.context === true,
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export function saveConfig(cfg: Config): void {
	try {
		fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
		fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, "\t")}\n`, "utf8");
	} catch {
		// non-fatal: config just won't persist
	}
}
