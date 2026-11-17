import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  fauxAssistantMessage,
  fauxProvider,
  getCurrentSystemPrompt,
  InMemoryCredentialStore
} from '@earendil-works/pi-ai'
import type { FauxProviderHandle } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  initTheme,
  ModelRuntime,
  SessionManager,
  SettingsManager
} from '@earendil-works/pi-coding-agent'
import type { AgentSession, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import languageTutor from '../language-learn.ts'
import { REVIEW_EVENT } from '../src/grammar.ts'
import type { ReviewEvent } from '../src/grammar.ts'

const { testHome } = await vi.hoisted(async () => {
  const tempFs = await import('node:fs')
  const tempOs = await import('node:os')
  const tempPath = await import('node:path')
  return {
    testHome: tempFs.mkdtempSync(tempPath.join(tempOs.tmpdir(), 'pi-language-tutor-test-'))
  }
})

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => testHome }
})

let session: AgentSession
let faux: FauxProviderHandle
let notifications: string[]
let widgets: Map<string, unknown>
let reviews: ReviewEvent[]
let claimReviews: boolean

/** Stands in for another extension that shows reviews somewhere else. */
function reviewListener(pi: ExtensionAPI): void {
  pi.events.on(REVIEW_EVENT, (data) => {
    const event = data as ReviewEvent
    reviews.push({ ...event })
    if (claimReviews) event.handled = true
  })
}

beforeEach(async () => {
  fs.rmSync(path.join(testHome, '.pi'), { recursive: true, force: true })
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  faux = fauxProvider({
    provider: 'language-tutor-test',
    models: [{ id: 'faux-1' }, { id: 'faux-2' }]
  })
  runtime.registerNativeProvider(faux.provider)
  await runtime.refresh({ allowNetwork: false })
  const agentDir = path.join(testHome, '.pi', 'agent')
  const settings = SettingsManager.inMemory()
  const resources = new DefaultResourceLoader({
    cwd: testHome,
    agentDir,
    settingsManager: settings,
    extensionFactories: [languageTutor, reviewListener],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true
  })
  await resources.reload()
  const result = await createAgentSession({
    cwd: testHome,
    agentDir,
    modelRuntime: runtime,
    model: faux.getModel(),
    resourceLoader: resources,
    sessionManager: SessionManager.inMemory(testHome),
    settingsManager: settings,
    noTools: 'all'
  })
  session = result.session
  if (result.extensionsResult.errors.length > 0) {
    throw new Error(`Extension load failed: ${JSON.stringify(result.extensionsResult.errors)}`)
  }
  notifications = []
  widgets = new Map()
  reviews = []
  claimReviews = false
  initTheme('dark', false)
  await session.bindExtensions({
    mode: 'tui',
    uiContext: {
      ...session.extensionRunner.getUIContext(),
      notify: (message) => notifications.push(message),
      setWidget: (key: string, content: unknown) => widgets.set(key, content)
    }
  })
})

afterEach(() => session?.dispose())
afterAll(() => fs.rmSync(testHome, { recursive: true, force: true }))

it('renders the bilingual card created by /translate in Pi', async () => {
  session.sessionManager.appendMessage(fauxAssistantMessage('The result is ready.'))
  faux.setResponses([fauxAssistantMessage('{"t":["结果已经准备好了。"]}')])

  await session.prompt('/translate')

  const card = session.sessionManager
    .getBranch()
    .find((entry) => entry.type === 'custom' && entry.customType === 'lang-translation')
  expect(card?.type).toBe('custom')
  if (card?.type !== 'custom') throw new Error('Missing translation card')
  const component = session.extensionRunner.getEntryRenderer(card.customType)?.(
    card,
    { expanded: false },
    session.extensionRunner.getUIContext().theme
  )
  const rendered = component?.render(80).join('\n') ?? ''
  expect(rendered).toContain('The result is ready.')
  expect(rendered).toContain('结果已经准备好了。')
  expect(notifications).toEqual([])
})

it('warns immediately when a model change prevents context cache reuse', async () => {
  await session.prompt('/lang check context')
  await session.prompt('/lang model language-tutor-test/faux-1')
  notifications.length = 0

  await session.setModel(faux.getModel('faux-2')!)

  expect(notifications).toEqual([
    expect.stringContaining('the session model is language-tutor-test/faux-2')
  ])
})

it('automatically translates a settled reply once', async () => {
  await session.prompt('/lang check off')
  await session.prompt('/lang auto on')
  const source =
    'The result is ready and the updated function now handles every supported input without changing the public API.'
  faux.setResponses([
    fauxAssistantMessage(source),
    fauxAssistantMessage('{"t":["The updated function is ready."]}')
  ])

  await session.prompt('Explain the result.')

  const cards = () =>
    session.sessionManager
      .getBranch()
      .filter((entry) => entry.type === 'custom' && entry.customType === 'lang-translation')
  await expect.poll(cards).toHaveLength(1)
  expect(cards()[0]).toMatchObject({
    data: {
      segments: [{ kind: 'pair', src: source, dst: 'The updated function is ready.' }]
    }
  })
  await session.extensionRunner.emit({ type: 'agent_settled' })
  expect(cards()).toHaveLength(1)
  expect(faux.state.callCount).toBe(2)
})

it('replays the session prompt and request prefix when translating with context', async () => {
  await session.prompt('/lang check off')
  await session.prompt('/lang context on')
  const requests: { systemPrompt: string; roles: string[] }[] = []
  const reply = 'The result is ready.'
  faux.setResponses(
    [reply, '{"t":["结果已经准备好了。"]}'].map((text) => (context) => {
      requests.push({
        systemPrompt: getCurrentSystemPrompt(context.messages),
        roles: context.messages.map((message) => message.role)
      })
      return fauxAssistantMessage(text)
    })
  )

  await session.prompt('Explain the result.')
  await session.prompt('/translate')

  expect(requests).toHaveLength(2)
  expect(requests[0].systemPrompt).not.toBe('')
  expect(requests[1].systemPrompt).toBe(requests[0].systemPrompt)
  expect(requests.map((request) => request.roles)).toEqual([
    ['system', 'user'],
    ['system', 'user', 'user']
  ])
})

const checkReply = JSON.stringify({
  mode: 'check',
  items: [{ wrong: 'teh', right: 'the', reason: 'typo' }],
  rephrase: 'Please fix the bug in the parser.'
})

async function review(prompt: string): Promise<void> {
  await session.extensionRunner.emitInput(prompt, undefined, 'interactive')
  await expect.poll(() => reviews).toHaveLength(1)
}

it('emits each review and still shows the widget when nobody claims it', async () => {
  faux.setResponses([fauxAssistantMessage(checkReply)])

  await review('Please fix teh bug in the parser.')

  expect(reviews[0]).toEqual({
    kind: 'check',
    prompt: 'Please fix teh bug in the parser.',
    items: [{ wrong: 'teh', right: 'the', reason: 'typo' }],
    rephrase: 'Please fix the bug in the parser.',
    handled: false
  })
  expect(widgets.get('language-learn')).toBeTypeOf('function')
})

it('skips the widget when a listener claims the review', async () => {
  claimReviews = true
  faux.setResponses([
    fauxAssistantMessage(
      JSON.stringify({
        mode: 'tutor',
        sentence: 'Please fix the parser bug.',
        words: [{ word: 'parser', note: 'note' }],
        grammar: []
      })
    )
  ])

  await review('파서 버그를 고쳐 주세요, 입력이 비어 있으면 오류가 납니다.')

  expect(reviews[0]).toMatchObject({ kind: 'tutor', sentence: 'Please fix the parser bug.' })
  expect(widgets.has('language-learn')).toBe(true)
  expect(widgets.get('language-learn')).toBeUndefined()
})
