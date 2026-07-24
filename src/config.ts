/**
 * Config persistence: ~/.pi/agent/language-learn.json.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Config } from './core.ts'
import { normalizeStoredConfig } from './core.ts'

const CONFIG_PATH = path.join(os.homedir(), '.pi', 'agent', 'language-learn.json')

export const DEFAULT_CONFIG: Config = normalizeStoredConfig({})

export function loadConfig(): Config {
  try {
    return normalizeStoredConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')))
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(cfg: Config): void {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, '\t')}\n`, 'utf8')
  } catch {
    // non-fatal: config just won't persist
  }
}
