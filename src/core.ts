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

export interface GrammarResult {
  skip?: boolean
  items?: GrammarItem[]
  rephrase?: string | null
}

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
// Writing check
// ---------------------------------------------------------------------------

export function shouldSkipCheck(text: string): boolean {
  if (text.startsWith('/') || text.startsWith('!')) return true
  if (text.split(/\s+/).filter(Boolean).length < 4) return true
  if (text.includes('```')) return true

  const chars = text.replace(/\s+/g, '')
  if (chars.length === 0) return true
  const letters = chars.match(/\p{L}/gu)?.length ?? 0
  if (letters / chars.length < 0.5) return true

  const words = text.split(/\s+/).filter(Boolean)
  const codey = words.filter((w) => /[{}()[\];=<>\\`$]|::|->|\.[a-z]{1,4}$|\//.test(w)).length
  return codey / words.length > 0.3
}

export function buildGrammarPrompt(text: string, cfg: Config): string {
  return [
    `You are a ${cfg.learning} writing tutor. The student's native language is ${cfg.native}.`,
    `The student typed the following message to an AI coding assistant. Check it.`,
    ``,
    `Respond with ONLY a JSON object, no markdown fences, in one of these forms:`,
    `- If the message is NOT primarily written in ${cfg.learning}, or there is nothing worth reporting: {"skip": true}`,
    `- Otherwise: {"skip": false, "items": [{"wrong": "...", "right": "...", "reason": "..."}], "rephrase": "..."}`,
    ``,
    `Rules:`,
    `- "items": genuine spelling/grammar errors only, at most 5. "wrong"/"right" are short exact fragments. "reason" is a very short explanation written in ${cfg.native}.`,
    `- "rephrase": only if the message is understandable but sounds noticeably non-native, give ONE more natural way to phrase it in ${cfg.learning}; otherwise use null.`,
    `- Ignore code, file paths, identifiers, product names, and technical jargon.`,
    `- Do not invent errors. A correct message gets {"skip": false, "items": [], "rephrase": null}.`,
    ``,
    `Message:`,
    `<<<`,
    text.slice(0, MAX_CHECK_CHARS),
    `>>>`
  ].join('\n')
}

export function parseGrammarResult(raw: string): GrammarResult | undefined {
  return extractJson<GrammarResult>(raw)
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

export type ModelMatch<M extends ModelRefLike> =
  | { kind: 'found'; model: M }
  | { kind: 'ambiguous'; candidates: M[] }
  | { kind: 'none' }

function decide<M extends ModelRefLike>(matches: M[]): ModelMatch<M> | undefined {
  if (matches.length === 1) return { kind: 'found', model: matches[0] }
  if (matches.length > 1) return { kind: 'ambiguous', candidates: matches }
  return undefined
}

/**
 * Match a user-supplied model reference the way pi's own resolver does
 * (`core/model-resolver.ts`, not re-exported by the package): canonical
 * `provider/id` match first — which also handles model ids that themselves
 * contain slashes — then a first-slash split, then a bare model id. All
 * comparisons are case-insensitive. A bare id shared by several providers is
 * reported as ambiguous with the candidates, so callers can list them.
 */
export function matchModelReference<M extends ModelRefLike>(
  reference: string,
  models: readonly M[]
): ModelMatch<M> {
  const ref = reference.trim().toLowerCase()
  if (!ref) return { kind: 'none' }

  const canonical = decide(models.filter((m) => `${m.provider}/${m.id}`.toLowerCase() === ref))
  if (canonical) return canonical

  const slash = ref.indexOf('/')
  if (slash > 0 && slash < ref.length - 1) {
    // Trimmed separately so "provider / id" with stray spaces still resolves.
    const provider = ref.slice(0, slash).trim()
    const id = ref.slice(slash + 1).trim()
    const split = decide(
      models.filter((m) => m.provider.toLowerCase() === provider && m.id.toLowerCase() === id)
    )
    if (split) return split
  }

  return decide(models.filter((m) => m.id.toLowerCase() === ref)) ?? { kind: 'none' }
}
