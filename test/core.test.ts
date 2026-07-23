import { describe, expect, it } from 'vitest'
import {
  shouldSkipCheck,
  parseGrammarResult,
  segmentMarkdown,
  cardMarkdown,
  buildSegmentPrompt,
  buildWholeTranslatePrompt,
  CONTEXT_PREFACE,
  resolveModelReference,
  resolveStoredModelReference,
  getProviderStreamSimple
} from '../language-learn.ts'
import { resolveModel } from '../src/llm.ts'
import type { StreamSimpleRegistry } from '../src/llm.ts'
import { warnOnCacheMismatch } from '../src/settings.ts'

describe('shouldSkipCheck', () => {
  describe('inputs that must be skipped', () => {
    it('slash command', () => {
      expect(shouldSkipCheck('/reload')).toBe(true)
    })
    it('slash command with args', () => {
      expect(shouldSkipCheck('/model anthropic claude something here')).toBe(true)
    })
    it('bang command', () => {
      expect(shouldSkipCheck('!ls -la some directory here')).toBe(true)
    })
    it('short reply: yes', () => {
      expect(shouldSkipCheck('yes')).toBe(true)
    })
    it('short reply: ok go ahead', () => {
      expect(shouldSkipCheck('ok go ahead')).toBe(true)
    })
    it('message containing a code fence', () => {
      expect(
        shouldSkipCheck('please fix this\n```ts\nconst x = 1\n```\nwhat is wrong with it exactly')
      ).toBe(true)
    })
    it('mostly code tokens', () => {
      expect(shouldSkipCheck('const x = foo(bar); y->z; a[i] = {b: 1};')).toBe(true)
    })
    it('mostly CJK when learning en (<4 whitespace words)', () => {
      expect(shouldSkipCheck('请帮我修复这个程序里的错误谢谢')).toBe(true)
    })
    it('symbols only', () => {
      expect(shouldSkipCheck('=== !== >>> <<< &&& ||| ??? *** !!!')).toBe(true)
    })
  })

  describe('inputs that must be checked', () => {
    it('one path among prose (1 codey of 5 words = 20%)', () => {
      expect(shouldSkipCheck('look at src/core/extensions/types.ts please')).toBe(false)
    })
    it('normal sentence with typos', () => {
      expect(shouldSkipCheck('I want create a extension to leading English')).toBe(false)
    })
    it('question mentioning one file', () => {
      expect(
        shouldSkipCheck('why does the loader in loader.ts fail when I reload the extension')
      ).toBe(false)
    })
    it('plain 4 words', () => {
      expect(shouldSkipCheck('please explain this error')).toBe(false)
    })
  })
})

describe('parseGrammarResult', () => {
  it('clean json', () => {
    expect(
      parseGrammarResult(
        '{"skip": false, "items": [{"wrong":"a","right":"b","reason":"c"}], "rephrase": null}'
      )
    ).toEqual({ skip: false, items: [{ wrong: 'a', right: 'b', reason: 'c' }], rephrase: null })
  })
  it('fenced json', () => {
    expect(parseGrammarResult('```json\n{"skip": true}\n```')).toEqual({ skip: true })
  })
  it('json with preamble', () => {
    expect(parseGrammarResult('Here is the result:\n{"skip": false, "items": []}')).toEqual({
      skip: false,
      items: []
    })
  })
  it('garbage', () => {
    expect(parseGrammarResult('I cannot help with that')).toBeUndefined()
  })
  it('truncated json', () => {
    expect(parseGrammarResult('{"skip": false, "items": [{"wrong": "a"')).toBeUndefined()
  })
})

describe('segmentMarkdown', () => {
  const md = `First, register the handler:

\`\`\`ts
pi.on("x", () => {});
\`\`\`

Then run it. It works.

\`\`\`sh
line1
line2
line3
line4
line5
line6
line7
\`\`\`

Done.`

  it('alternates prose and code segments', () => {
    expect(segmentMarkdown(md).map((s) => s.kind)).toEqual([
      'prose',
      'code',
      'prose',
      'code',
      'prose'
    ])
  })
  it('counts code lines per block', () => {
    expect(
      segmentMarkdown(md)
        .filter((s) => s.kind === 'code')
        .map((s) => s.lines)
    ).toEqual([1, 7])
  })
  it('extracts prose texts', () => {
    expect(
      segmentMarkdown(md)
        .filter((s) => s.kind === 'prose')
        .map((s) => s.text)
    ).toEqual(['First, register the handler:', 'Then run it. It works.', 'Done.'])
  })
  it('no code blocks', () => {
    expect(segmentMarkdown('Just one paragraph.\n\nAnd another.')).toEqual([
      { kind: 'prose', text: 'Just one paragraph.' },
      { kind: 'prose', text: 'And another.' }
    ])
  })
  it('unclosed fence still yields a code segment', () => {
    expect(segmentMarkdown('intro\n\n```\ncode').map((s) => s.kind)).toEqual(['prose', 'code'])
  })
  it('empty input', () => {
    expect(segmentMarkdown('')).toEqual([])
  })
})

describe('cardMarkdown', () => {
  const card = cardMarkdown([
    { kind: 'pair', src: 'Hello world.', dst: '你好世界。' },
    { kind: 'code', text: '```ts\nx()\n```' },
    { kind: 'codeRef', lines: 23 }
  ])

  it('renders translation pair as blockquote', () => {
    expect(card).toContain('Hello world.\n\n> 你好世界。')
  })
  it('keeps short code blocks verbatim', () => {
    expect(card).toContain('```ts\nx()\n```')
  })
  it('replaces long code with a placeholder', () => {
    expect(card).toContain('*[code block ↑ 23 lines]*')
  })
})

describe('prompt builders', () => {
  const cfg = { learning: 'en', native: 'zh-CN', enabled: true, auto: false, context: false }

  it('segment prompt numbers segments and pins the count', () => {
    const sp = buildSegmentPrompt(['a', 'b'], cfg)
    expect(sp).toContain('[0]\na')
    expect(sp).toContain('[1]\nb')
    expect(sp).toContain('exactly 2 strings')
  })
  it('segment prompt has no context preface by default', () => {
    expect(buildSegmentPrompt(['a', 'b'], cfg)).not.toContain(CONTEXT_PREFACE)
  })
  it('contextual segment prompt starts with the preface', () => {
    expect(buildSegmentPrompt(['a'], cfg, true).startsWith(CONTEXT_PREFACE)).toBe(true)
  })
  it('whole-translate prompt wraps the source text', () => {
    expect(buildWholeTranslatePrompt('some text', cfg)).toContain('<<<\nsome text\n>>>')
  })
  it('contextual whole-translate prompt starts with the preface', () => {
    expect(buildWholeTranslatePrompt('x', cfg, true).startsWith(CONTEXT_PREFACE)).toBe(true)
  })
})

const fakeStream = (() => ({ result: async () => ({}) })) as never
const registry = (
  config: ReturnType<StreamSimpleRegistry['getRegisteredProviderConfig']>
): StreamSimpleRegistry => ({ getRegisteredProviderConfig: () => config })

describe('getProviderStreamSimple (custom providers, e.g. cursor-sdk)', () => {
  it('uses the registered streamSimple when the api matches', () => {
    expect(
      typeof getProviderStreamSimple(registry({ api: 'cursor-sdk', streamSimple: fakeStream }), {
        provider: 'cursor',
        api: 'cursor-sdk'
      })
    ).toBe('function')
  })
  it('ignores streamSimple when the api mismatches', () => {
    expect(
      getProviderStreamSimple(registry({ api: 'cursor-sdk', streamSimple: fakeStream }), {
        provider: 'cursor',
        api: 'openai-completions'
      })
    ).toBeUndefined()
  })
  it('falls back when the provider has no streamSimple', () => {
    expect(
      getProviderStreamSimple(registry({ api: 'openai-completions' }), {
        provider: 'zai',
        api: 'openai-completions'
      })
    ).toBeUndefined()
  })
  it('falls back when the provider config is undefined', () => {
    expect(
      getProviderStreamSimple(registry(undefined), { provider: 'cursor', api: 'cursor-sdk' })
    ).toBeUndefined()
  })
})

describe('resolveModelReference (pi CLI -m semantics)', () => {
  const zai = { provider: 'zai', id: 'glm-5' }
  const gateway = { provider: 'gateway', id: 'zai/glm-5' }
  const openai = { provider: 'openai', id: 'gpt-4o-mini' }
  const azure = { provider: 'azure', id: 'gpt-4o-mini' }
  const catalog = [zai, gateway, openai, azure]

  it('prefers the provider interpretation over a raw-id lookalike', () => {
    expect(resolveModelReference('zai/glm-5', catalog, catalog)).toEqual({
      kind: 'found',
      model: zai
    })
  })
  it('canonical ref reaches a model whose id contains a slash', () => {
    expect(resolveModelReference('gateway/zai/glm-5', catalog, catalog)).toEqual({
      kind: 'found',
      model: gateway
    })
  })
  it('auth-aware tiebreak: unauthed provider ref falls to the unique authed raw id', () => {
    expect(resolveModelReference('zai/glm-5', [gateway], catalog)).toEqual({
      kind: 'found',
      model: gateway
    })
  })
  it('needsAuth when the provider ref has no authed raw-id lookalike', () => {
    expect(resolveModelReference('openai/gpt-4o-mini', [azure], catalog)).toEqual({
      kind: 'needsAuth',
      model: openai
    })
  })
  it('known provider without that model still matches the whole ref as a raw id', () => {
    const zaiOther = { provider: 'zai', id: 'glm-4' }
    expect(resolveModelReference('zai/glm-5', [gateway, zaiOther], [gateway, zaiOther])).toEqual({
      kind: 'found',
      model: gateway
    })
  })
  it('resolves a unique bare id among configured-auth models', () => {
    expect(resolveModelReference('glm-5', [zai, openai], catalog)).toEqual({
      kind: 'found',
      model: zai
    })
  })
  it('reports an ambiguous bare id with its candidates', () => {
    expect(resolveModelReference('gpt-4o-mini', catalog, catalog)).toEqual({
      kind: 'ambiguous',
      candidates: [openai, azure]
    })
  })
  it('bare id known only to unconfigured catalogs reports noAuthAnywhere', () => {
    expect(resolveModelReference('gpt-4o-mini', [], catalog)).toEqual({
      kind: 'noAuthAnywhere',
      candidates: [openai, azure]
    })
  })
  it('matches case-insensitively', () => {
    expect(resolveModelReference('ZAI/GLM-5', catalog, catalog).kind).toBe('found')
  })
  it('unknown reference', () => {
    expect(resolveModelReference('gpt-nonexistent', catalog, catalog)).toEqual({ kind: 'none' })
  })
  it('empty reference', () => {
    expect(resolveModelReference('  ', catalog, catalog)).toEqual({ kind: 'none' })
  })
})

const lang = (model?: string, context = false) => ({
  learning: 'en',
  native: 'zh-CN',
  model,
  enabled: true,
  auto: false,
  context
})

describe('resolveModel (pi CLI semantics over available/catalog)', () => {
  const openai = { provider: 'openai', id: 'gpt-4o-mini' }
  const azure = { provider: 'azure', id: 'gpt-4o-mini' }
  const cloudflare = { provider: 'cloudflare', id: 'gpt-4o-mini' }
  const session = { provider: 'anthropic', id: 'claude-sonnet-5' }
  const catalog = [openai, azure, cloudflare, session]
  const ctx = (available: unknown[]) =>
    ({
      modelRegistry: { getAvailable: () => available, getAll: () => catalog },
      model: session
    }) as never

  it('resolves a bare id against configured-auth models even when other catalogs list it', () => {
    expect(resolveModel(ctx([openai, session]), lang('gpt-4o-mini') as never)).toBe(openai)
  })
  it('an override that lost auth still resolves from the catalog (fails visibly later)', () => {
    expect(resolveModel(ctx([session]), lang('openai/gpt-4o-mini') as never)).toBe(openai)
  })
  it('a bare id ambiguous among available models falls back to the session model', () => {
    expect(resolveModel(ctx([openai, azure, session]), lang('gpt-4o-mini') as never)).toBe(session)
  })
  it('an unknown override falls back to the session model', () => {
    expect(resolveModel(ctx([session]), lang('gpt-nonexistent') as never)).toBe(session)
  })
  it('no override uses the session model', () => {
    expect(resolveModel(ctx([session]), lang(undefined) as never)).toBe(session)
  })
})

describe('warnOnCacheMismatch', () => {
  const session = { provider: 'openai', id: 'gpt-4o-mini' }
  const other = { provider: 'zai', id: 'glm-5' }
  const azureDup = { provider: 'azure', id: 'gpt-4o-mini' }
  const ctx = (notes: string[], available = [session, other], all = [session, other]) =>
    ({
      model: session,
      modelRegistry: { getAvailable: () => available, getAll: () => all },
      ui: {
        notify: (msg: string) => {
          notes.push(msg)
        }
      }
    }) as never

  it('does not warn when a hand-edited ref resolves to the session model', () => {
    const notes: string[] = []
    warnOnCacheMismatch(ctx(notes), lang('GPT-4O-MINI', true) as never)
    expect(notes).toEqual([])
  })
  it('warns when the override resolves to a different model', () => {
    const notes: string[] = []
    warnOnCacheMismatch(ctx(notes), lang('glm-5', true) as never)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('zai/glm-5')
  })
  it('stays quiet while context mode is off', () => {
    const notes: string[] = []
    warnOnCacheMismatch(ctx(notes), lang('glm-5', false) as never)
    expect(notes).toEqual([])
  })
  it('uses the same available/catalog resolution as runLlm: an unauthed catalog duplicate does not fake a mismatch', () => {
    const notes: string[] = []
    warnOnCacheMismatch(
      ctx(notes, [session, other], [session, other, azureDup]),
      lang('gpt-4o-mini', true) as never
    )
    expect(notes).toEqual([])
  })
})

describe('resolveStoredModelReference (saved config refs)', () => {
  const openai = { provider: 'openai', id: 'gpt-4o-mini' }
  const openrouter = { provider: 'openrouter', id: 'openai/gpt-4o-mini' }
  const catalog = [openai, openrouter]

  it('restores a saved canonical ref exactly, as needsAuth when its provider lost auth', () => {
    expect(resolveStoredModelReference('openai/gpt-4o-mini', [openrouter], catalog)).toEqual({
      kind: 'needsAuth',
      model: openai
    })
  })
  it('returns found when the saved canonical ref still has auth', () => {
    expect(resolveStoredModelReference('openai/gpt-4o-mini', [openai], catalog)).toEqual({
      kind: 'found',
      model: openai
    })
  })
  it('falls back to interactive semantics for a hand-edited bare id', () => {
    expect(resolveStoredModelReference('gpt-4o-mini', [openai], catalog)).toEqual({
      kind: 'found',
      model: openai
    })
  })
  it('a saved provider ref whose model left the catalog is not raw-matched onto a lookalike', () => {
    const openaiOther = { provider: 'openai', id: 'gpt-4o' }
    expect(
      resolveStoredModelReference('openai/gpt-4o-mini', [openrouter], [openaiOther, openrouter])
    ).toEqual({ kind: 'none' })
  })
  it('a raw id whose prefix names no provider still resolves interactively', () => {
    const orphan = { provider: 'openrouter', id: 'mistral/devstral' }
    expect(resolveStoredModelReference('mistral/devstral', [orphan], [orphan])).toEqual({
      kind: 'found',
      model: orphan
    })
  })
})

describe('slash-containing refs follow pi CLI semantics (OpenRouter-style ids)', () => {
  const openai = { provider: 'openai', id: 'gpt-4o-mini' }
  const openrouter = { provider: 'openrouter', id: 'openai/gpt-4o-mini' }
  const session = { provider: 'anthropic', id: 'claude-sonnet-5' }
  const catalog = [openai, openrouter, session]
  const ctx = (available: unknown[]) =>
    ({
      modelRegistry: { getAvailable: () => available, getAll: () => catalog },
      model: session
    }) as never

  it('a saved canonical override is restored exactly even when an authed raw-id lookalike exists', () => {
    expect(resolveModel(ctx([openrouter, session]), lang('openai/gpt-4o-mini') as never)).toBe(
      openai
    )
  })
  it('the openrouter model stays reachable through its canonical ref', () => {
    expect(
      resolveModel(ctx([openrouter, session]), lang('openrouter/openai/gpt-4o-mini') as never)
    ).toBe(openrouter)
  })
  it('a slash-containing reference matching no catalog provider still resolves as a bare id', () => {
    const orphan = { provider: 'openrouter', id: 'mistral/devstral' }
    const orphanCtx = {
      modelRegistry: { getAvailable: () => [orphan, session], getAll: () => [orphan, session] },
      model: session
    } as never
    expect(resolveModel(orphanCtx, lang('mistral/devstral') as never)).toBe(orphan)
  })
  it('a bare id that lost auth everywhere still resolves from the catalog (fails visibly later)', () => {
    expect(resolveModel(ctx([session]), lang('gpt-4o-mini') as never)).toBe(openai)
  })
})
