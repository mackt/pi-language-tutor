import { describe, expect, it } from 'vitest'
import {
  shouldSkipCheck,
  parseGrammarResult,
  segmentMarkdown,
  cardMarkdown,
  buildSegmentPrompt,
  buildWholeTranslatePrompt,
  CONTEXT_PREFACE,
  matchModelReference,
  getProviderStreamSimple
} from '../language-learn.ts'
import type { StreamSimpleRegistry } from '../src/llm.ts'

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

describe('matchModelReference', () => {
  const models = [
    { provider: 'openai', id: 'gpt-4o-mini' },
    { provider: 'azure', id: 'gpt-4o-mini' },
    { provider: 'anthropic', id: 'claude-sonnet-5' },
    { provider: 'openrouter', id: 'openai/gpt-4o-mini' }
  ]

  it('canonical provider/id wins over a same-named bare id elsewhere', () => {
    expect(matchModelReference('openai/gpt-4o-mini', models)).toEqual({
      kind: 'found',
      model: { provider: 'openai', id: 'gpt-4o-mini' }
    })
  })
  it('resolves a model id that itself contains a slash', () => {
    expect(matchModelReference('openrouter/openai/gpt-4o-mini', models)).toEqual({
      kind: 'found',
      model: { provider: 'openrouter', id: 'openai/gpt-4o-mini' }
    })
  })
  it('resolves a unique bare id', () => {
    expect(matchModelReference('claude-sonnet-5', models)).toEqual({
      kind: 'found',
      model: { provider: 'anthropic', id: 'claude-sonnet-5' }
    })
  })
  it('reports an ambiguous bare id with its candidates', () => {
    expect(matchModelReference('gpt-4o-mini', models)).toEqual({
      kind: 'ambiguous',
      candidates: [
        { provider: 'openai', id: 'gpt-4o-mini' },
        { provider: 'azure', id: 'gpt-4o-mini' }
      ]
    })
  })
  it('matches case-insensitively', () => {
    expect(matchModelReference('Anthropic/Claude-Sonnet-5', models).kind).toBe('found')
  })
  it('tolerates spaces around the slash', () => {
    expect(matchModelReference('anthropic / claude-sonnet-5', models).kind).toBe('found')
  })
  it('unknown reference', () => {
    expect(matchModelReference('gpt-nonexistent', models)).toEqual({ kind: 'none' })
  })
  it('empty reference', () => {
    expect(matchModelReference('  ', models)).toEqual({ kind: 'none' })
  })
})
