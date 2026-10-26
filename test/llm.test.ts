import { expect, it } from 'vitest'
import {
  fauxAssistantMessage,
  fauxProvider,
  getCurrentSystemPrompt,
  getCurrentTools,
  InMemoryCredentialStore
} from '@earendil-works/pi-ai'
import {
  createExtensionRuntime,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager
} from '@earendil-works/pi-coding-agent'
import { runLlm } from '../src/llm.ts'

it('preserves the session prompt, tools, and cache options in contextual completions', async () => {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  const faux = fauxProvider({ provider: 'language-tutor-test' })
  runtime.registerNativeProvider(faux.provider)
  const session = SessionManager.inMemory()
  const runner = new ExtensionRunner(
    [],
    createExtensionRuntime(),
    process.cwd(),
    session,
    new ModelRegistry(runtime)
  )
  let request: unknown
  faux.setResponses([
    (context, options) => {
      request = {
        systemPrompt: getCurrentSystemPrompt(context.messages),
        tools: getCurrentTools(context.messages).map((tool) => tool.name),
        roles: context.messages.map((message) => message.role),
        reasoning: options?.reasoning,
        sessionId: options?.sessionId
      }
      return fauxAssistantMessage('Translated.')
    }
  ])

  const text = await runLlm(
    runner.createContext(),
    faux.getModel(),
    'Translate the reply.',
    undefined,
    {
      systemPrompt: 'Keep project terminology.',
      messages: [{ role: 'user', content: 'Earlier request.', timestamp: 0 }],
      tools: [{ name: 'read', description: 'Read a file.', parameters: { type: 'object' } }],
      reasoning: 'medium'
    }
  )

  expect({ text, request }).toEqual({
    text: 'Translated.',
    request: {
      systemPrompt: 'Keep project terminology.',
      tools: ['read'],
      roles: ['system', 'user', 'user'],
      reasoning: 'medium',
      sessionId: session.getSessionId()
    }
  })
})

it('routes virtual models through the Pi model runtime', async () => {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  const faux = fauxProvider({ provider: 'language-tutor-test' })
  runtime.registerNativeProvider(faux.provider)
  runtime.registerVirtualModel({
    provider: 'language-tutor-router',
    id: 'auto',
    name: 'Automatic language model',
    route: () => ({ model: faux.getModel(), thinkingLevel: 'off' })
  })
  await runtime.refresh({ allowNetwork: false })
  faux.setResponses([fauxAssistantMessage('Translated through the router.')])
  const registry = new ModelRegistry(runtime)
  const runner = new ExtensionRunner(
    [],
    createExtensionRuntime(),
    process.cwd(),
    SessionManager.inMemory(),
    registry
  )

  await expect(
    runLlm(runner.createContext(), registry.find('language-tutor-router', 'auto')!, 'Translate.')
  ).resolves.toBe('Translated through the router.')
})

it('does not return a translation when the completion is cancelled', async () => {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  const faux = fauxProvider({ provider: 'language-tutor-test' })
  runtime.registerNativeProvider(faux.provider)
  const runner = new ExtensionRunner(
    [],
    createExtensionRuntime(),
    process.cwd(),
    SessionManager.inMemory(),
    new ModelRegistry(runtime)
  )
  const controller = new AbortController()
  controller.abort()
  faux.setResponses([fauxAssistantMessage('Should not be returned.')])

  await expect(
    runLlm(runner.createContext(), faux.getModel(), 'Translate.', controller.signal)
  ).resolves.toBeUndefined()
})

it.each(['error', 'aborted'] as const)(
  'does not return partial text from an %s completion',
  async (stopReason) => {
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false
    })
    const faux = fauxProvider({ provider: 'language-tutor-test' })
    runtime.registerNativeProvider(faux.provider)
    const runner = new ExtensionRunner(
      [],
      createExtensionRuntime(),
      process.cwd(),
      SessionManager.inMemory(),
      new ModelRegistry(runtime)
    )
    faux.setResponses([fauxAssistantMessage('Partial translation.', { stopReason })])

    await expect(
      runLlm(runner.createContext(), faux.getModel(), 'Translate.')
    ).resolves.toBeUndefined()
  }
)
