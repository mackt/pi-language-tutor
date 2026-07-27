import { describe, expect, it } from 'vitest'
import {
  addCard,
  addCards,
  cardStats,
  deleteCard,
  getDueCards,
  listCards,
  mergeCards,
  needsRetry,
  updateCard,
  rateCard,
  Rating
} from '../src/flashcards.ts'
import { clampSettings, DEFAULT_SETTINGS } from '../src/flashcard-settings.ts'
import type { FlashcardEntry } from '../src/flashcards.ts'

function makeCard(word: string, note = 'a note'): FlashcardEntry {
  const cards: FlashcardEntry[] = []
  addCard(cards, word, note)
  return cards[0]
}

describe('addCard', () => {
  it('adds a card with trimmed word and note', () => {
    const cards: FlashcardEntry[] = []
    expect(addCard(cards, '  hola  ', '  hello  ')).toBe(true)
    expect(cards).toHaveLength(1)
    expect(cards[0].word).toBe('hola')
    expect(cards[0].note).toBe('hello')
  })

  it('dedupes by word, case-insensitive', () => {
    const cards: FlashcardEntry[] = []
    expect(addCard(cards, 'Hola', 'hello')).toBe(true)
    expect(addCard(cards, 'hola', 'hi again')).toBe(false)
    expect(addCard(cards, '  HOLA ', 'hi again')).toBe(false)
    expect(cards).toHaveLength(1)
  })

  it('rejects empty word or note', () => {
    const cards: FlashcardEntry[] = []
    expect(addCard(cards, '', 'note')).toBe(false)
    expect(addCard(cards, '   ', 'note')).toBe(false)
    expect(addCard(cards, 'word', '')).toBe(false)
    expect(addCard(cards, 'word', '  ')).toBe(false)
    expect(cards).toHaveLength(0)
  })

  it('addCards returns the count actually added', () => {
    const cards: FlashcardEntry[] = []
    const n = addCards(cards, [
      { word: 'uno', note: 'one' },
      { word: 'dos', note: 'two' },
      { word: 'UNO', note: 'dup' }
    ])
    expect(n).toBe(2)
    expect(cards).toHaveLength(2)
  })
})

describe('getDueCards / cardStats', () => {
  it('new cards are always due', () => {
    const cards = [makeCard('a'), makeCard('b')]
    expect(getDueCards(cards)).toHaveLength(2)
    expect(cardStats(cards)).toEqual({
      total: 2,
      due: 2,
      newCards: 2,
      lastReview: null,
      nextDue: null
    })
  })

  it('a reviewed card with a future due date is not due', () => {
    const card = makeCard('a')
    rateCard(card, Rating.Easy)
    expect(card.fsrs.state).not.toBe(0)
    expect(card.fsrs.due.getTime()).toBeGreaterThan(Date.now())
    expect(getDueCards([card])).toHaveLength(0)
    const stats = cardStats([card])
    expect(stats).toMatchObject({ total: 1, due: 0, newCards: 0 })
    expect(stats.lastReview).not.toBeNull()
    expect(stats.nextDue).toBe(card.fsrs.due.toISOString())
  })

  it('a reviewed card with a past due date is due', () => {
    const card = makeCard('a')
    rateCard(card, Rating.Easy)
    card.fsrs.due = new Date(Date.now() - 1000)
    expect(getDueCards([card])).toHaveLength(1)
  })

  it('respects the limit', () => {
    const cards = Array.from({ length: 25 }, (_, i) => makeCard(`w${i}`))
    expect(getDueCards(cards, 20)).toHaveLength(20)
    expect(getDueCards(cards)).toHaveLength(20)
  })
})

describe('updateCard', () => {
  it('updates word and note, trimmed', () => {
    const card = makeCard('a')
    expect(updateCard(card, '  new word ', ' new note ')).toBe(true)
    expect(card.word).toBe('new word')
    expect(card.note).toBe('new note')
  })

  it('rejects empty input and leaves the card unchanged', () => {
    const card = makeCard('a', 'original note')
    expect(updateCard(card, '', 'note')).toBe(false)
    expect(updateCard(card, 'word', '  ')).toBe(false)
    expect(card.word).toBe('a')
    expect(card.note).toBe('original note')
  })
})

describe('deleteCard', () => {
  it('removes the card by id', () => {
    const a = makeCard('a')
    const b = makeCard('b')
    const cards = [a, b]
    expect(deleteCard(cards, a.id)).toBe(true)
    expect(cards.map((c) => c.word)).toEqual(['b'])
  })

  it('returns false for unknown id', () => {
    const cards = [makeCard('a')]
    expect(deleteCard(cards, 'nope')).toBe(false)
    expect(cards).toHaveLength(1)
  })
})

describe('needsRetry', () => {
  it('Again and Hard keep the card in the session', () => {
    expect(needsRetry(Rating.Again)).toBe(true)
    expect(needsRetry(Rating.Hard)).toBe(true)
  })

  it('Good and Easy graduate the card', () => {
    expect(needsRetry(Rating.Good)).toBe(false)
    expect(needsRetry(Rating.Easy)).toBe(false)
  })
})

describe('rateCard', () => {
  it('updates FSRS state and schedules a future review', () => {
    const card = makeCard('a')
    rateCard(card, Rating.Good)
    expect(card.fsrs.reps).toBe(1)
    expect(card.fsrs.last_review).toBeInstanceOf(Date)
    expect(card.fsrs.due.getTime()).toBeGreaterThan(Date.now())
  })

  it('a single rating graduates a new card to a day-level interval', () => {
    // enable_short_term is off: no minute-level learning steps, so a rated
    // card must not reappear in the next /learn session minutes later.
    const card = makeCard('a')
    rateCard(card, Rating.Good)
    expect(card.fsrs.state).toBe(2 /* Review */)
    expect(card.fsrs.due.getTime()).toBeGreaterThan(Date.now() + 24 * 60 * 60 * 1000)
  })

  it('even Again graduates, with the shortest interval', () => {
    const card = makeCard('a')
    rateCard(card, Rating.Again)
    expect(card.fsrs.state).toBe(2 /* Review */)
    expect(card.fsrs.due.getTime()).toBeGreaterThan(Date.now() + 12 * 60 * 60 * 1000)
  })
})

describe('clampSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(clampSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(clampSettings('junk')).toEqual(DEFAULT_SETTINGS)
    expect(clampSettings({ newPerDay: 'lots' })).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps to sane ranges', () => {
    expect(clampSettings({ newPerDay: -5, sessionLimit: 9999, requestRetention: 0.5 })).toEqual({
      newPerDay: 0,
      sessionLimit: 200,
      requestRetention: 0.7,
      theme: 'system'
    })
    expect(clampSettings({ requestRetention: 0.99 }).requestRetention).toBe(0.97)
    expect(clampSettings({ theme: 'neon' }).theme).toBe('system')
    expect(clampSettings({ theme: 'dark' }).theme).toBe('dark')
  })
})

describe('daily new-card budget', () => {
  it('the first rating of a new card records introducedAt', () => {
    const card = makeCard('a')
    expect(card.introducedAt).toBeUndefined()
    rateCard(card, Rating.Good)
    expect(card.introducedAt).toBeTruthy()
  })

  it('newPerDay=0 keeps new cards out of the due list', () => {
    const cards = [makeCard('a'), makeCard('b')]
    const settings = { ...DEFAULT_SETTINGS, newPerDay: 0 }
    expect(getDueCards(cards, 20, settings)).toHaveLength(0)
    expect(cardStats(cards, settings).due).toBe(0)
  })

  it('cards introduced today count against the budget', () => {
    const a = makeCard('a')
    const b = makeCard('b')
    rateCard(a, Rating.Easy) // consumes today's new-card slot, now future-due
    expect(getDueCards([a, b], 20, { ...DEFAULT_SETTINGS, newPerDay: 1 })).toHaveLength(0)
    const due = getDueCards([a, b], 20, { ...DEFAULT_SETTINGS, newPerDay: 2 })
    expect(due.map((c) => c.word)).toEqual(['b'])
  })
})

describe('listCards', () => {
  it('summarizes cards, soonest due first with new cards on top', () => {
    const fresh = makeCard('fresh')
    const reviewed = makeCard('reviewed')
    rateCard(reviewed, Rating.Easy) // due in days
    const list = listCards([reviewed, fresh])
    expect(list).toHaveLength(2)
    // New card's due is in the past (creation time) so it sorts first
    expect(list[0].word).toBe('fresh')
    expect(list[0].state).toBe(0)
    expect(list[1].word).toBe('reviewed')
    expect(list[1].state).toBe(2)
    expect(list[1].reps).toBe(1)
    expect(typeof list[1].due).toBe('string')
  })

  it('includes lapses and notes', () => {
    const card = makeCard('hard-word', 'a tricky one')
    rateCard(card, Rating.Again)
    rateCard(card, Rating.Again)
    const [summary] = listCards([card])
    expect(summary.note).toBe('a tricky one')
    expect(summary.lapses).toBeGreaterThan(0)
  })
})

describe('mergeCards', () => {
  it('memory version wins for cards present in both', () => {
    const memory = makeCard('a')
    rateCard(memory, Rating.Good)
    const disk = { ...memory, note: 'stale note' }
    const merged = mergeCards([disk], [memory])
    expect(merged).toHaveLength(1)
    expect(merged[0].note).toBe('a note')
    expect(merged[0].fsrs.reps).toBe(1)
  })

  it('keeps disk-only cards (captured while a review window was open)', () => {
    const memory = makeCard('a')
    const diskOnly = makeCard('b')
    const merged = mergeCards([memory, diskOnly], [memory])
    expect(merged.map((c) => c.word)).toEqual(['a', 'b'])
  })

  it('keeps memory-only cards', () => {
    const memory = makeCard('a')
    const merged = mergeCards([], [memory])
    expect(merged).toHaveLength(1)
  })
})
