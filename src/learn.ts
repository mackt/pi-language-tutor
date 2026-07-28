/**
 * Learn: review session controller. Opens a glimpse window, streams cards,
 * and processes FSRS ratings from the frontend.
 *
 * Protocol: host pushes `overview` (stats + library) on ready and whenever a
 * session drains, `card` for each review step; the window sends `ready`,
 * `start`, and `rate`.
 */

import { readFileSync } from 'node:fs'
import { open, type GlimpseWindow } from 'glimpseui'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import {
  applySettings,
  cardStats,
  deleteCard,
  getDueCards,
  listCards,
  loadCards,
  mergeCards,
  needsRetry,
  rateCard,
  saveCards,
  updateCard,
  Rating,
  type CardSummary,
  type FlashcardEntry,
  type Grade
} from './flashcards.ts'
import {
  clampSettings,
  loadSettings,
  saveSettings,
  type FlashcardSettings
} from './flashcard-settings.ts'

const REVIEW_HTML = new URL('../web/flashcards.html', import.meta.url)

function loadReviewHtml(): string {
  return readFileSync(REVIEW_HTML, 'utf8')
}

function escapeInline(value: string): string {
  return value.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

interface OverviewPayload {
  type: 'overview'
  total: number
  due: number
  newCards: number
  lastReview: string | null
  nextDue: string | null
  /** Cards still queued for another pass this round (Again/Hard retries). */
  pending: number
  theme: FlashcardSettings['theme']
  cards: CardSummary[]
}

interface CardPayload {
  type: 'card'
  card: FlashcardEntry
}

interface SettingsPayload {
  type: 'settings'
  settings: FlashcardSettings
}

type HostMessage = OverviewPayload | CardPayload | SettingsPayload

type WindowMessage =
  | { type: 'ready' }
  | { type: 'overview' }
  | { type: 'start' }
  | { type: 'settings' }
  | { type: 'saveSettings'; settings: unknown }
  | { type: 'saveTheme'; theme: unknown }
  | { type: 'edit'; id: string; word: string; note: string }
  | { type: 'delete'; id: string }
  | { type: 'rate'; id: string; rating: Grade }

function parseMessage(value: unknown): WindowMessage | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (v.type === 'ready') return { type: 'ready' }
  if (v.type === 'overview') return { type: 'overview' }
  if (v.type === 'start') return { type: 'start' }
  if (v.type === 'settings') return { type: 'settings' }
  if (v.type === 'saveSettings') {
    if (typeof v.settings !== 'object' || v.settings === null) return null
    return { type: 'saveSettings', settings: v.settings }
  }
  if (v.type === 'saveTheme') return { type: 'saveTheme', theme: v.theme }
  if (v.type === 'edit') {
    if (typeof v.id !== 'string' || typeof v.word !== 'string' || typeof v.note !== 'string')
      return null
    return { type: 'edit', id: v.id, word: v.word, note: v.note }
  }
  if (v.type === 'delete') {
    if (typeof v.id !== 'string') return null
    return { type: 'delete', id: v.id }
  }
  if (v.type === 'rate') {
    if (typeof v.cardId !== 'string' || typeof v.rating !== 'number') return null
    if (!Number.isInteger(v.rating) || v.rating < Rating.Again || v.rating > Rating.Easy)
      return null
    return { type: 'rate', id: v.cardId, rating: v.rating as Grade }
  }
  return null
}

export function registerLearn(pi: ExtensionAPI): void {
  let window: GlimpseWindow | null = null
  // Full card list plus the review queue (references into `cards`).
  let cards: FlashcardEntry[] = []
  let queue: FlashcardEntry[] = []
  // Ids explicitly deleted this session: tombstones so persist() can tell
  // "deleted here" apart from "captured on disk while the window was open".
  const deleted = new Set<string>()
  let settings: FlashcardSettings = loadSettings()

  const send = (msg: HostMessage): void => {
    if (!window) return
    const payload = escapeInline(JSON.stringify(msg))
    try {
      window.send(`window.__reviewReceive(${payload})`)
    } catch {
      // window gone
    }
  }

  const sendOverview = (): void => {
    send({ type: 'overview', ...cardStats(cards, settings), pending: queue.length, theme: settings.theme, cards: listCards(cards) })
  }

  /** Persist, merging with whatever landed on disk since we loaded. */
  const persist = (): void => {
    saveCards(mergeCards(loadCards(), cards).filter((c) => !deleted.has(c.id)))
  }

  const sendNext = (): void => {
    const head = queue[0]
    if (!head) {
      // Session drained: back to the overview, with stats reflecting the ratings.
      sendOverview()
      return
    }
    send({ type: 'card', card: head })
  }

  /** After edit/delete: advance if the card was under review, else refresh stats. */
  const refreshAfter = (wasHead: boolean): void => {
    if (wasHead) sendNext()
    else sendOverview()
  }

  const handleMessage = (value: unknown): void => {
    const msg = parseMessage(value)
    if (!msg) return

    switch (msg.type) {
      case 'ready':
        sendOverview()
        return

      // Page re-entered the main view mid-session: push fresh stats/list.
      case 'overview':
        sendOverview()
        return

      case 'start':
        // Queue drained (e.g. session limit hit) but more cards due: deal a
        // fresh session so Enter keeps reviewing without reopening /flashcards.
        if (queue.length === 0) queue = getDueCards(cards, settings.sessionLimit, settings)
        sendNext()
        return

      case 'settings':
        settings = loadSettings()
        send({ type: 'settings', settings })
        return

      case 'saveSettings':
        settings = clampSettings(msg.settings)
        saveSettings(settings)
        applySettings(settings)
        // Confirm the clamped values and refresh stats (daily budget may have changed)
        send({ type: 'settings', settings })
        sendOverview()
        return

      case 'saveTheme':
        settings = clampSettings({ ...settings, theme: msg.theme })
        saveSettings(settings)
        return

      case 'edit': {
        const target = cards.find((c) => c.id === msg.id)
        if (!target || !updateCard(target, msg.word, msg.note)) return
        persist()
        refreshAfter(queue[0]?.id === msg.id)
        return
      }

      case 'delete': {
        const wasHead = queue[0]?.id === msg.id
        const qIdx = queue.findIndex((c) => c.id === msg.id)
        if (qIdx >= 0) queue.splice(qIdx, 1)
        if (!deleteCard(cards, msg.id)) return
        deleted.add(msg.id)
        persist()
        refreshAfter(wasHead)
        return
      }

      case 'rate': {
        // Only accept a rating for the card currently shown, so a
        // stale/duplicate keypress can't rate the next, unseen card.
        const head = queue[0]
        if (!head || head.id !== msg.id) return

        rateCard(head, msg.rating)
        queue.shift()
        // Again/Hard = not learned yet: re-queue at the end for another pass
        // this session. Only Good/Easy graduate (Anki-style learning steps).
        if (needsRetry(msg.rating)) queue.push(head)
        persist()

        sendNext()
        return
      }
    }
  }

  const openReview = async (ctx: ExtensionContext) => {
    if (!ctx.hasUI || ctx.mode !== 'tui') {
      ctx.ui.notify('/flashcards requires interactive TUI mode.', 'warning')
      return
    }

    if (window) {
      window.show({ title: 'Flashcards' })
      return
    }

    cards = loadCards()
    queue = []
    deleted.clear()

    // glimpseui spawns the native window with stderr hardcoded to inherit,
    // so macOS IMK framework noise (TSM/IMKCFRunLoop logs) leaks into pi's
    // TUI. OS_ACTIVITY_MODE=disable silences it in the child process.
    process.env.OS_ACTIVITY_MODE = 'disable'
    window = open(loadReviewHtml(), { width: 600, height: 500, title: 'Flashcards' })
    delete process.env.OS_ACTIVITY_MODE
    window.on('message', handleMessage)
    window.on('closed', () => {
      persist()
      window = null
    })
  }

  pi.registerCommand('flashcards', {
    description: 'Review flashcards from the Writing tutor',
    handler: async (_args, ctx) => openReview(ctx)
  })
}
