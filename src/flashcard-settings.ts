/**
 * Flashcard settings: schema, defaults, clamping, persistence.
 * Pure logic — no pi imports.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const SETTINGS_PATH = path.join(os.homedir(), '.pi', 'agent', 'flashcards-settings.json')

export interface FlashcardSettings {
  /** New cards introduced per day (Anki-style daily limit). */
  newPerDay: number
  /** Max cards dealt in one review round. */
  sessionLimit: number
  /** FSRS desired retention — higher means shorter intervals. Not exposed in the UI. */
  requestRetention: number
}

export const DEFAULT_SETTINGS: FlashcardSettings = {
  newPerDay: 20,
  sessionLimit: 20,
  requestRetention: 0.9
}

const numOr = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Sanitize an untrusted settings value, clamping to sane ranges. */
export function clampSettings(raw: unknown): FlashcardSettings {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    newPerDay: Math.round(clampNum(numOr(r.newPerDay, DEFAULT_SETTINGS.newPerDay), 0, 500)),
    sessionLimit: Math.round(
      clampNum(numOr(r.sessionLimit, DEFAULT_SETTINGS.sessionLimit), 1, 200)
    ),
    requestRetention:
      Math.round(
        clampNum(numOr(r.requestRetention, DEFAULT_SETTINGS.requestRetention), 0.7, 0.97) * 100
      ) / 100
  }
}

export function loadSettings(): FlashcardSettings {
  try {
    return clampSettings(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: FlashcardSettings): void {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
    const tmp = SETTINGS_PATH + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(settings, null, '\t') + '\n', 'utf8')
    fs.renameSync(tmp, SETTINGS_PATH)
  } catch {
    // non-fatal
  }
}
