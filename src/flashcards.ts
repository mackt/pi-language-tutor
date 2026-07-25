/**
 * Flashcards: card persistence, FSRS scheduling, and review logic.
 * Pure logic — no pi imports.
 */

import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DEFAULT_SETTINGS, loadSettings, type FlashcardSettings } from './flashcard-settings.ts'

export { Rating }
export type { Grade }

const FLASHCARDS_PATH = path.join(os.homedir(), '.pi', 'agent', 'flashcards.json')

// No short-term (minute-level) learning steps: /learn is opened manually
// between coding sessions, so a single rating graduates a card to a
// day-level interval. Same-session retries are handled by re-queuing
// Again/Hard cards in learn.ts instead.
let scheduler = fsrs({
  enable_short_term: false,
  request_retention: loadSettings().requestRetention
})

/** Rebuild the FSRS scheduler after the settings change. */
export function applySettings(settings: FlashcardSettings): void {
  scheduler = fsrs({
    enable_short_term: false,
    request_retention: settings.requestRetention
  })
}

export interface FlashcardEntry {
  id: string
  word: string
  note: string
  source: 'tutor' | 'manual'
  createdAt: string
  /** When the card left the New state — drives the daily new-card budget. */
  introducedAt?: string
  fsrs: Card
}

export function loadCards(): FlashcardEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(FLASHCARDS_PATH, 'utf8'))
    if (!Array.isArray(raw)) return []
    // Revive ISO date strings back to Date objects inside FSRS cards
    return raw.filter(isEntry).map(reviveDates)
  } catch {
    return []
  }
}

export function saveCards(cards: FlashcardEntry[]): void {
  try {
    fs.mkdirSync(path.dirname(FLASHCARDS_PATH), { recursive: true })
    // JSON.stringify calls Date#toJSON, so due/last_review serialize as ISO.
    // Write-then-rename: a crash mid-write must not truncate the library.
    const tmp = FLASHCARDS_PATH + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(cards, null, '\t') + '\n', 'utf8')
    fs.renameSync(tmp, FLASHCARDS_PATH)
  } catch {
    // non-fatal
  }
}

/**
 * Merge a long-lived in-memory list with what is currently on disk.
 * Cards present in both take the in-memory version (it holds the latest FSRS
 * state); cards only on disk (e.g. captured by the tutor while a review
 * window was open) are kept. Prevents a stale review session from
 * overwriting newer additions.
 */
export function mergeCards(disk: FlashcardEntry[], memory: FlashcardEntry[]): FlashcardEntry[] {
  const memoryById = new Map(memory.map((c) => [c.id, c]))
  const merged = disk.map((c) => memoryById.get(c.id) ?? c)
  const diskIds = new Set(disk.map((c) => c.id))
  for (const c of memory) {
    if (!diskIds.has(c.id)) merged.push(c)
  }
  return merged
}

let idCounter = 0

function nextId(): string {
  return `${Date.now().toString(36)}-${(idCounter++).toString(36)}`
}

/** Add a card, deduplicating by word (case-insensitive). Returns true if added. */
export function addCard(
  cards: FlashcardEntry[],
  word: string,
  note: string,
  source: 'tutor' | 'manual' = 'tutor'
): boolean {
  const key = word.trim().toLowerCase()
  if (!key || !note.trim()) return false
  if (cards.some((c) => c.word.trim().toLowerCase() === key)) return false
  cards.push({
    id: nextId(),
    word: word.trim(),
    note: note.trim(),
    source,
    createdAt: new Date().toISOString(),
    fsrs: createEmptyCard()
  })
  return true
}

/** Add cards in bulk. Returns count actually added (after dedup). */
export function addCards(
  cards: FlashcardEntry[],
  items: { word: string; note: string }[],
  source: 'tutor' | 'manual' = 'tutor'
): number {
  let n = 0
  for (const item of items) {
    if (addCard(cards, item.word, item.note, source)) n++
  }
  return n
}

/** Cards due for review, oldest first. New cards are capped by the daily budget. */
export function getDueCards(
  cards: FlashcardEntry[],
  limit = DEFAULT_SETTINGS.sessionLimit,
  settings: FlashcardSettings = DEFAULT_SETTINGS
): FlashcardEntry[] {
  const now = new Date()
  const budget = newBudget(cards, settings, now)
  let newTaken = 0
  const due: FlashcardEntry[] = []
  for (const c of cards) {
    if (due.length >= limit) break
    if (!isDue(c, now)) continue
    if (c.fsrs.state === 0 /* New */) {
      if (newTaken >= budget) continue
      newTaken++
    }
    due.push(c)
  }
  return due
}

/** How many more new cards may be introduced today. */
function newBudget(cards: FlashcardEntry[], settings: FlashcardSettings, now: Date): number {
  const today = now.toDateString()
  const introducedToday = cards.filter(
    (c) => c.introducedAt && new Date(c.introducedAt).toDateString() === today
  ).length
  return Math.max(0, settings.newPerDay - introducedToday)
}

/** Overview stats for the main page: totals, last review, and next due time. */
export function cardStats(
  cards: FlashcardEntry[],
  settings: FlashcardSettings = DEFAULT_SETTINGS
): {
  total: number
  due: number
  newCards: number
  lastReview: string | null
  nextDue: string | null
} {
  const now = new Date()
  let last: Date | null = null
  let next: Date | null = null
  for (const c of cards) {
    if (c.fsrs.last_review && (!last || c.fsrs.last_review > last)) last = c.fsrs.last_review
    // Earliest not-yet-due review — tells the user when cards come back
    if (!isDue(c, now) && c.fsrs.due) {
      const due = new Date(c.fsrs.due)
      if (!next || due < next) next = due
    }
  }
  const reviewDue = cards.filter((c) => c.fsrs.state !== 0 && isDue(c, now)).length
  const newCount = cards.filter((c) => c.fsrs.state === 0 /* New */).length
  return {
    total: cards.length,
    // What a session would actually deal: due reviews plus today's new budget
    due: reviewDue + Math.min(newBudget(cards, settings, now), newCount),
    newCards: newCount,
    lastReview: last ? last.toISOString() : null,
    nextDue: next ? next.toISOString() : null
  }
}

function isDue(c: FlashcardEntry, now: Date): boolean {
  // New cards are always due
  if (c.fsrs.state === 0 /* New */) return true
  if (!c.fsrs.due) return true
  return new Date(c.fsrs.due) <= now
}

/** Apply an FSRS rating to a card, updating its scheduling state in place. */
export function rateCard(card: FlashcardEntry, rating: Grade): void {
  // First time out of the New state — counts toward today's new-card budget
  if (card.fsrs.state === 0 /* New */ && !card.introducedAt) {
    card.introducedAt = new Date().toISOString()
  }
  card.fsrs = scheduler.next(card.fsrs, new Date(), rating).card
}

/** Edit a card's word/note in place. Returns false on empty input. */
export function updateCard(card: FlashcardEntry, word: string, note: string): boolean {
  const w = word.trim()
  const n = note.trim()
  if (!w || !n) return false
  card.word = w
  card.note = n
  return true
}

/** Remove a card by id. Returns true if it existed. */
export function deleteCard(cards: FlashcardEntry[], id: string): boolean {
  const idx = cards.findIndex((c) => c.id === id)
  if (idx === -1) return false
  cards.splice(idx, 1)
  return true
}

/**
 * Ratings that mean "not learned yet": the card stays in the session for
 * another pass (Anki-style learning steps). Good/Easy graduate immediately.
 */
export function needsRetry(rating: Grade): boolean {
  return rating === Rating.Again || rating === Rating.Hard
}

/** A card as shown in the library list. */
export interface CardSummary {
  id: string
  word: string
  note: string
  /** FSRS state: 0 New, 1 Learning, 2 Review, 3 Relearning. */
  state: number
  due: string | null
  reps: number
  lapses: number
}

/** All cards for the library list, soonest due first (new cards on top). */
export function listCards(cards: FlashcardEntry[]): CardSummary[] {
  return cards
    .map((c) => ({
      id: c.id,
      word: c.word,
      note: c.note,
      state: c.fsrs.state,
      due: c.fsrs.due ? new Date(c.fsrs.due).toISOString() : null,
      reps: c.fsrs.reps,
      lapses: c.fsrs.lapses
    }))
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))
}

function isEntry(v: unknown): v is FlashcardEntry {
  if (typeof v !== 'object' || v === null) return false
  const e = v as FlashcardEntry
  return typeof e.id === 'string' && typeof e.word === 'string' && typeof e.note === 'string'
}

function reviveDates(entry: FlashcardEntry): FlashcardEntry {
  if (entry.fsrs?.due) {
    entry.fsrs.due = new Date(entry.fsrs.due as unknown as string)
  }
  if (entry.fsrs?.last_review) {
    entry.fsrs.last_review = new Date(entry.fsrs.last_review as unknown as string)
  }
  return entry
}
