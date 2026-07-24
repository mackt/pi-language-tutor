/**
 * Pure core: text heuristics, prompt builders, response parsing, and bilingual
 * card assembly. No pi imports, no I/O — everything here is testable with
 * plain values (see test.mjs).
 */

export interface Config {
  learning: string
  native: string
  model?: string
  enabled: boolean
  auto: boolean
  /** Fork the main session's context into translation calls (default off: costs cache reads). */
  context: boolean
}

export interface GrammarItem {
  wrong: string
  right: string
  reason: string
}

/** A vocabulary item taught by the tutor: the word as used in the sentence + a note in the native language. */
export interface TutorWord {
  word: string
  note: string
}

/** A grammar structure taught by the tutor: name of the structure + a note in the native language. */
export interface TutorGrammar {
  structure: string
  note: string
}

/** The tutor payload: a natural rendering of the whole thought, plus the words and grammar worth learning. */
export interface TutorResult {
  sentence: string
  words: TutorWord[]
  grammar: TutorGrammar[]
}

/**
 * One review pass over a prompt. The agent decides the mode:
 * - `check`: the prompt is in the learning language — review it (existing writing check).
 * - `tutor`: the prompt is in the native (or another non-learning) language — teach how to say it in the learning language.
 * - `skip`: neither (too short, code, unclear).
 */
export type ReviewResult =
  | { mode: 'check'; items: GrammarItem[]; rephrase: string | null }
  | { mode: 'tutor'; tutor: TutorResult }
  | { mode: 'skip' }

export type Segment =
  | { kind: 'prose'; text: string }
  | { kind: 'code'; text: string; lines: number }

export type CardSegment =
  | { kind: 'pair'; src: string; dst: string }
  | { kind: 'code'; text: string }
  | { kind: 'codeRef'; lines: number }

export interface TranslationCard {
  native: string
  /** Legacy / fallback format: plain translation of the whole message. */
  text?: string
  /** Bilingual format: interleaved original/translation segments. */
  segments?: CardSegment[]
}

export const MAX_CHECK_CHARS = 1500
export const MAX_TRANSLATE_CHARS = 12000
/** Code blocks longer than this many content lines become a placeholder in the bilingual card. */
export const SHORT_CODE_LINES = 5
/** Final responses shorter than this many words are not auto-translated. */
export const MIN_AUTO_WORDS = 15

const TRANSLATION_LABELS: Record<string, string> = {
  zh: '译文',
  ja: '訳文',
  ko: '번역',
  es: 'Traducción',
  fr: 'Traduction',
  de: 'Übersetzung',
  pt: 'Tradução',
  ru: 'Перевод',
  en: 'Translation'
}

export function translationLabel(native: string): string {
  return TRANSLATION_LABELS[native.split('-')[0].toLowerCase()] ?? 'Translation'
}

export function extractJson<T>(raw: string): T | undefined {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as T
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Review (writing check + writing tutor)
// ---------------------------------------------------------------------------

/**
 * Should the review be skipped for this prompt? Covers slash/bang commands,
 * trivially short prompts, code fences, symbol-heavy text, and mostly-code
 * text. CJK text is NOT penalized for lacking spaces — a CJK sentence is
 * counted by characters, so a substantial native-language prompt still
 * reaches the tutor.
 */
export function shouldSkipCheck(text: string): boolean {
  if (text.startsWith('/') || text.startsWith('!')) return true
  if (text.includes('```')) return true

  const chars = text.replace(/\s+/g, '')
  if (chars.length === 0) return true

  // Content units: whitespace-separated words for Latin scripts, plus CJK
  // characters counted individually (CJK text is rarely space-separated).
  // Fewer than 4 units is too short to review or tutor.
  const words = text.split(/\s+/).filter(Boolean)
  const cjk = text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/gu)?.length ?? 0
  if (Math.max(words.length, cjk) < 4) return true

  const letters = chars.match(/\p{L}/gu)?.length ?? 0
  if (letters / chars.length < 0.5) return true

  const codey = words.filter((w) => /[{}()[\];=<>\\`$]|::|->|\.[a-z]{1,4}$|\//.test(w)).length
  return words.length > 0 && codey / words.length > 0.3
}

export function buildReviewPrompt(text: string, cfg: Config): string {
  return [
    `You are a ${cfg.learning} language tutor. The student's native language is ${cfg.native}.`,
    `The student typed the following message to an AI coding assistant. Decide which mode applies, then respond accordingly.`,
    ``,
    `Respond with ONLY a JSON object, no markdown fences:`,
    ``,
    `If the message IS primarily written in ${cfg.learning} (mode "check") — review it:`,
    `  {"mode": "check", "items": [{"wrong": "...", "right": "...", "reason": "..."}], "rephrase": "..." or null}`,
    `  - "items": genuine spelling/grammar errors only, at most 5. "wrong"/"right" are short exact fragments. "reason" is a very short explanation written in ${cfg.native}.`,
    `  - "rephrase": only if the message is understandable but sounds noticeably non-native, give ONE more natural way to phrase it in ${cfg.learning}; otherwise null.`,
    `  - A correct message: {"mode": "check", "items": [], "rephrase": null}.`,
    ``,
    `If the message is NOT primarily written in ${cfg.learning} — e.g. it is in ${cfg.native} or another language (mode "tutor") — the student could not express it in ${cfg.learning}; teach them how:`,
    `  {"mode": "tutor", "sentence": "...", "words": [{"word": "...", "note": "..."}], "grammar": [{"structure": "...", "note": "..."}]}`,
    `  - "sentence": a natural, idiomatic ${cfg.learning} rendering of the student's WHOLE thought (not a word-by-word gloss).`,
    `  - "words": the key vocabulary worth learning (at most 5). "word" is the ${cfg.learning} word/phrase exactly as used in "sentence". "note" is a short explanation in ${cfg.native}: meaning, usage, register, and why this word over an obvious synonym.`,
    `  - "grammar": the grammatical structures carrying the sentence (at most 3). "structure" names the structure (e.g. tense, mood, particle, clause shape, agreement). "note" explains in ${cfg.native} what it is and why it is used here.`,
    `  - If the message is too short, code, or has no clear meaning to teach, return {"mode": "skip"} instead.`,
    ``,
    `If neither mode fits (too short, code, unclear): {"mode": "skip"}`,
    ``,
    `Rules:`,
    `- Ignore code, file paths, identifiers, product names, and technical jargon — do not try to fix or translate them.`,
    `- A message already correct in ${cfg.learning} is mode "check" with empty items, NOT "tutor".`,
    `- Never invent errors, never invent vocabulary the student did not express.`,
    ``,
    `Message:`,
    `<<<`,
    text.slice(0, MAX_CHECK_CHARS),
    `>>>`
  ].join('\n')
}

export function parseReviewResult(raw: string): ReviewResult | undefined {
  const obj = extractJson<{
    mode?: string
    skip?: boolean
    items?: GrammarItem[]
    rephrase?: string | null
    sentence?: string
    words?: TutorWord[]
    grammar?: TutorGrammar[]
  }>(raw)
  if (!obj) return undefined

  if (obj.mode === 'tutor') {
    const sentence = typeof obj.sentence === 'string' ? obj.sentence.trim() : ''
    const words = Array.isArray(obj.words)
      ? obj.words.filter((w) => w && typeof w.word === 'string' && typeof w.note === 'string')
      : []
    const grammar = Array.isArray(obj.grammar)
      ? obj.grammar.filter(
          (g) => g && typeof g.structure === 'string' && typeof g.note === 'string'
        )
      : []
    if (!sentence && words.length === 0 && grammar.length === 0) return { mode: 'skip' }
    return {
      mode: 'tutor',
      tutor: { sentence, words: words.slice(0, 5), grammar: grammar.slice(0, 3) }
    }
  }

  if (obj.mode === 'skip' || obj.skip === true) return { mode: 'skip' }

  // mode "check" (default — also tolerates responses that omit "mode")
  const items = Array.isArray(obj.items)
    ? obj.items.filter(
        (i) =>
          i &&
          typeof i.wrong === 'string' &&
          i.wrong.trim().length > 0 &&
          typeof i.right === 'string' &&
          i.right.trim().length > 0
      )
    : []
  const rephrase =
    typeof obj.rephrase === 'string' && obj.rephrase.trim().length > 0 ? obj.rephrase.trim() : null
  return { mode: 'check', items: items.slice(0, 5), rephrase }
}

// ---------------------------------------------------------------------------
// Bilingual translation
// ---------------------------------------------------------------------------

/** Split markdown into prose paragraphs and fenced code blocks. */
export function segmentMarkdown(src: string): Segment[] {
  const segments: Segment[] = []
  let prose: string[] = []
  let code: string[] = []
  let inCode = false

  const flushProse = () => {
    const paragraphs = prose
      .join('\n')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    for (const p of paragraphs) segments.push({ kind: 'prose', text: p })
    prose = []
  }

  for (const line of src.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (inCode) {
        code.push(line)
        segments.push({ kind: 'code', text: code.join('\n'), lines: code.length - 2 })
        code = []
        inCode = false
      } else {
        flushProse()
        code.push(line)
        inCode = true
      }
    } else if (inCode) {
      code.push(line)
    } else {
      prose.push(line)
    }
  }
  if (inCode) {
    // unclosed fence: treat what we have as a code block
    segments.push({ kind: 'code', text: code.join('\n'), lines: Math.max(0, code.length - 1) })
  }
  flushProse()
  return segments
}

export const CONTEXT_PREFACE =
  'The conversation above is the session this response came from — use it to resolve terminology, referents, and project-specific names.'

export function buildSegmentPrompt(proseTexts: string[], cfg: Config, contextual = false): string {
  const numbered = proseTexts.map((t, i) => `[${i}]\n${t}`).join('\n\n')
  return [
    ...(contextual ? [CONTEXT_PREFACE] : []),
    `Translate each numbered segment of an AI coding assistant's response into ${cfg.native}.`,
    `Keep inline code, file paths, commands, and technical identifiers untranslated. Preserve markdown formatting within each segment.`,
    ``,
    `Respond with ONLY this JSON, no markdown fences:`,
    `{"t": ["...", "..."]}`,
    `"t" must contain exactly ${proseTexts.length} strings; item i is the translation of segment [i].`,
    ``,
    `Segments:`,
    numbered
  ].join('\n')
}

/** Fallback prompt: whole-text translation when segment alignment fails. */
export function buildWholeTranslatePrompt(source: string, cfg: Config, contextual = false): string {
  return [
    ...(contextual ? [CONTEXT_PREFACE] : []),
    `Translate the following AI coding assistant response into ${cfg.native}.`,
    `Keep code blocks, inline code, file paths, commands, and technical identifiers exactly as-is (untranslated).`,
    `Preserve the markdown structure. Output ONLY the translation.`,
    ``,
    `<<<`,
    source,
    `>>>`
  ].join('\n')
}

/** Assemble the bilingual card markdown: original paragraph, translation as blockquote. */
export function cardMarkdown(segments: CardSegment[]): string {
  return segments
    .map((s) => {
      switch (s.kind) {
        case 'pair':
          return `${s.src}\n\n> ${s.dst.replace(/\n/g, '\n> ')}`
        case 'code':
          return s.text
        case 'codeRef':
          return `*[code block ↑ ${s.lines} lines]*`
      }
    })
    .join('\n\n')
}

/** The subset of a registry model a reference can be matched against. */
export interface ModelRefLike {
  provider: string
  id: string
}

export type ModelResolution<M extends ModelRefLike> =
  /** Resolved to a model with configured auth. */
  | { kind: 'found'; model: M }
  /** Resolved, but the model's provider has no configured auth. */
  | { kind: 'needsAuth'; model: M }
  /** Several configured-auth models match a bare id. */
  | { kind: 'ambiguous'; candidates: M[] }
  /** Only unconfigured providers' catalogs list this bare id. */
  | { kind: 'noAuthAnywhere'; candidates: M[] }
  | { kind: 'none' }

function decide<M extends ModelRefLike>(
  matches: M[]
): { kind: 'found'; model: M } | { kind: 'ambiguous'; candidates: M[] } | undefined {
  if (matches.length === 1) return { kind: 'found', model: matches[0] }
  if (matches.length > 1) return { kind: 'ambiguous', candidates: matches }
  return undefined
}

/**
 * Resolve a user-supplied model reference the way pi's CLI `-m` does
 * (`core/model-resolver.ts`, not re-exported by the package):
 *
 * 1. When the prefix before the first slash names a known provider, prefer
 *    the `provider/id` interpretation ("zai/glm-5" is zai's glm-5, not a
 *    gateway model whose id is literally "zai/glm-5").
 * 2. If that interpretation exists only without auth while exactly one
 *    configured-auth model's raw id equals the whole reference, prefer the
 *    authenticated one (ids like "xiaomi/mimo-v2.5-pro" where the prefix
 *    happens to name a provider).
 * 3. Otherwise fall back to matching the whole reference as a canonical
 *    `provider/id` or a raw model id — OpenRouter-style ids keep working.
 *
 * All comparisons are case-insensitive. `available` is the configured-auth
 * subset of `catalog`; pass the same list twice to resolve identity only.
 */
export function resolveModelReference<M extends ModelRefLike>(
  reference: string,
  available: readonly M[],
  catalog: readonly M[]
): ModelResolution<M> {
  const ref = reference.trim().toLowerCase()
  if (!ref) return { kind: 'none' }

  const slash = ref.indexOf('/')
  if (slash > 0 && slash < ref.length - 1) {
    const prefix = ref.slice(0, slash)
    if (catalog.some((m) => m.provider.toLowerCase() === prefix)) {
      const id = ref.slice(slash + 1)
      const inProvider = (models: readonly M[]) =>
        models.filter((m) => m.provider.toLowerCase() === prefix && m.id.toLowerCase() === id)
      const availableHit = decide(inProvider(available))
      if (availableHit) return availableHit
      const catalogHit = decide(inProvider(catalog))
      if (catalogHit?.kind === 'found') {
        const rawMatches = available.filter((m) => m.id.toLowerCase() === ref)
        if (rawMatches.length === 1) return { kind: 'found', model: rawMatches[0] }
        return { kind: 'needsAuth', model: catalogHit.model }
      }
      // Known provider but no such model under it: fall through — the whole
      // reference may still be a raw model id elsewhere.
    }
  }

  const whole = (models: readonly M[]) =>
    models.filter(
      (m) => m.id.toLowerCase() === ref || `${m.provider}/${m.id}`.toLowerCase() === ref
    )
  const availableHit = decide(whole(available))
  if (availableHit) return availableHit
  const catalogHit = decide(whole(catalog))
  if (catalogHit?.kind === 'found') return { kind: 'needsAuth', model: catalogHit.model }
  if (catalogHit?.kind === 'ambiguous') {
    return { kind: 'noAuthAnywhere', candidates: catalogHit.candidates }
  }
  return { kind: 'none' }
}

/**
 * Resolve a reference persisted in the config. Unlike interactive input, a
 * saved canonical `provider/id` is an already-disambiguated answer: restore
 * it exactly from the catalog — reporting `needsAuth` when its provider lost
 * auth, so side-calls fail visibly instead of being silently re-routed to an
 * authed provider whose raw id happens to spell the same. A ref whose prefix
 * names a known provider but whose exact model left the catalog (dropped or
 * renamed) resolves to nothing — the caller falls back to the session model —
 * rather than raw-matching the string onto another provider's lookalike id.
 * Only refs not interpretable as a provider choice (hand-edited bare ids, or
 * raw ids whose prefix is no provider) fall back to the interactive
 * {@link resolveModelReference} semantics.
 */
export function resolveStoredModelReference<M extends ModelRefLike>(
  reference: string,
  available: readonly M[],
  catalog: readonly M[]
): ModelResolution<M> {
  const ref = reference.trim().toLowerCase()
  if (!ref) return { kind: 'none' }

  const exact = decide(catalog.filter((m) => `${m.provider}/${m.id}`.toLowerCase() === ref))
  if (exact?.kind === 'found') {
    const authed = available.some(
      (m) => m.provider === exact.model.provider && m.id === exact.model.id
    )
    return authed ? exact : { kind: 'needsAuth', model: exact.model }
  }

  const slash = ref.indexOf('/')
  if (slash > 0 && catalog.some((m) => m.provider.toLowerCase() === ref.slice(0, slash))) {
    return { kind: 'none' }
  }

  return resolveModelReference(reference, available, catalog)
}
