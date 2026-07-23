/**
 * LLM access: model resolution, completion calls, and the session-fork
 * machinery that lets a call replay the main session's request prefix so the
 * provider's prompt cache is reused.
 */

import { completeSimple } from '@earendil-works/pi-ai/compat'
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Message,
  SimpleStreamOptions,
  Tool
} from '@earendil-works/pi-ai/compat'
import { convertToLlm } from '@earendil-works/pi-coding-agent'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { resolveStoredModelReference } from './core.ts'
import type { Config } from './core.ts'

export type ResolvedModel = NonNullable<ExtensionContext['model']>

type StreamSimpleFn = (
  model: ResolvedModel,
  context: Context,
  options?: SimpleStreamOptions
) => AssistantMessageEventStream

/**
 * A fork of the main session's last LLM request. When the prefix (tools,
 * system prompt, messages) is byte-identical to what the agent sent, the
 * provider's prompt cache is reused and the history costs cache-read prices.
 */
export interface ForkContext {
  systemPrompt: string
  messages: Message[]
  tools?: Tool[]
  reasoning: SimpleStreamOptions['reasoning']
}

/** Narrow registry surface used by {@link getProviderStream} (testable). */
export type ProviderRegistry = {
  getProvider(provider: string): { streamSimple?: StreamSimpleFn } | undefined
}

/** Legacy 0.80 registry surface for config-registered custom providers. */
export type RegisteredProviderConfigRegistry = {
  getRegisteredProviderConfig(
    provider: string
  ): { api?: string; streamSimple?: StreamSimpleFn } | undefined
}

/** Current registry surface for request-scoped provider auth. */
export type ProviderAuthRegistry = {
  getProviderAuth(provider: string): Promise<{ auth: { baseUrl?: string } } | undefined>
}

type SideCallRegistry = Partial<ProviderRegistry> &
  Partial<RegisteredProviderConfigRegistry> &
  Partial<ProviderAuthRegistry>

/**
 * Resolve the composed provider's `streamSimple` for a model. The composed
 * provider dispatches the same way the main session does — extension handler
 * when the model's api matches, else the base provider, else the global api
 * registry — and covers custom providers registered either as a config
 * (`registerProvider(name, config)`, e.g. `cursor-sdk`) or as a native
 * `Provider` object, which `getRegisteredProviderConfig` cannot see.
 */
export function getProviderStream(
  registry: ProviderRegistry,
  model: Pick<ResolvedModel, 'provider'>
): StreamSimpleFn | undefined {
  const provider = registry.getProvider(model.provider)
  if (typeof provider?.streamSimple !== 'function') return undefined
  return (m, context, options) => provider.streamSimple!(m, context, options)
}

/** Resolve a legacy config-registered provider stream when it owns the model's api. */
export function getRegisteredProviderStream(
  registry: RegisteredProviderConfigRegistry,
  model: Pick<ResolvedModel, 'provider' | 'api'>
): StreamSimpleFn | undefined {
  const config = registry.getRegisteredProviderConfig(model.provider)
  if (typeof config?.streamSimple !== 'function') return undefined
  if (config.api !== undefined && config.api !== model.api) return undefined
  return (m, context, options) => config.streamSimple!(m, context, options)
}

/**
 * If provider auth resolves a request-scoped baseUrl, copy it onto the model
 * before dispatching directly to provider.streamSimple. This mirrors the
 * runtime request-preparation step that side-calls bypass on pi 0.81+.
 */
export async function withProviderAuthBaseUrl<
  T extends Pick<ResolvedModel, 'provider'> & { baseUrl?: string }
>(registry: Partial<ProviderAuthRegistry>, model: T): Promise<T> {
  if (typeof registry.getProviderAuth !== 'function') return model
  const auth = await registry.getProviderAuth(model.provider)
  const baseUrl = auth?.auth.baseUrl
  return baseUrl ? { ...model, baseUrl } : model
}

/**
 * pi 0.80 originally registered extension `streamSimple` handlers into the
 * global api registry, so `completeSimple` worked for custom apis. Later 0.80
 * builds exposed config-registered handlers through `getRegisteredProviderConfig`,
 * and pi 0.81 moved dispatch onto the composed provider (`getProvider`). Try
 * the composed provider first, keep the config fallback for 0.80.8–0.80.10,
 * then fall back to `completeSimple` for built-ins and older runtimes.
 */
async function completeWithModel(
  ctx: ExtensionContext,
  model: ResolvedModel,
  context: Context,
  options: SimpleStreamOptions
): Promise<AssistantMessage> {
  const registry = ctx.modelRegistry as ExtensionContext['modelRegistry'] & SideCallRegistry
  const requestModel = await withProviderAuthBaseUrl(registry, model)

  if (typeof registry.getProvider === 'function') {
    const providerStream = getProviderStream(
      { getProvider: (id) => registry.getProvider!(id) },
      requestModel
    )
    if (providerStream) {
      return providerStream(requestModel, context, options).result()
    }
  }

  if (typeof registry.getRegisteredProviderConfig === 'function') {
    const providerStream = getRegisteredProviderStream(
      { getRegisteredProviderConfig: (id) => registry.getRegisteredProviderConfig!(id) },
      requestModel
    )
    if (providerStream) {
      return providerStream(requestModel, context, options).result()
    }
  }

  return completeSimple(requestModel, context, options)
}

/** The model to use for checks and translations: the configured override, else the session model. */
export function resolveModel(ctx: ExtensionContext, cfg: Config): ResolvedModel | undefined {
  if (cfg.model && cfg.model !== 'default') {
    // A saved canonical provider/id is restored exactly; only hand-edited
    // bare ids go through CLI-style disambiguation. `needsAuth` is returned
    // too: an override whose provider lost its auth (/logout, env var
    // removed) must fail visibly at runLlm's auth check, not silently
    // re-route side-calls to another provider.
    const resolved = resolveStoredModelReference(
      cfg.model,
      ctx.modelRegistry.getAvailable(),
      ctx.modelRegistry.getAll()
    )
    if (resolved.kind === 'found' || resolved.kind === 'needsAuth') return resolved.model
  }
  return ctx.model
}

/** Run a single-prompt completion; with `fork`, replay the session prefix first. */
export async function runLlm(
  ctx: ExtensionContext,
  model: ResolvedModel,
  prompt: string,
  signal?: AbortSignal,
  fork?: ForkContext
): Promise<string | undefined> {
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model)
  if (!auth.ok) return undefined

  const user: Message = {
    role: 'user',
    content: [{ type: 'text' as const, text: prompt }],
    timestamp: Date.now()
  }
  const response = await completeWithModel(
    ctx,
    model,
    fork
      ? { systemPrompt: fork.systemPrompt, messages: [...fork.messages, user], tools: fork.tools }
      : { messages: [user] },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      signal,
      // Providers that key their prompt cache on a session ID (OpenAI
      // Responses, Mistral Conversations) only reuse the main session's
      // cache if the fork sends the same ID.
      ...(fork ? { reasoning: fork.reasoning, sessionId: ctx.sessionManager.getSessionId() } : {})
    }
  )

  // A fork replays the agent's system prompt and tool definitions, so the
  // model may answer with a tool call instead of text. Report failure so the
  // caller can retry without the fork.
  if (response.stopReason === 'toolUse') return undefined

  return response.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim()
}

/**
 * Track the main session's LLM requests so `makeFork` can replay the exact
 * prefix of the most recent one. Returns undefined before the first request
 * (callers then fall back to a context-free call).
 */
export function createForkTracker(pi: ExtensionAPI): {
  makeFork(ctx: ExtensionContext): ForkContext | undefined
} {
  // Messages of the main session's most recent LLM request, converted with the
  // same convertToLlm pi's agent uses — a hand-rolled filter would drop bash
  // executions, custom messages, and compaction/branch summaries, breaking the
  // byte-identical prefix the prompt cache needs.
  let sessionLlmMessages: Message[] | undefined

  pi.on('context', (event) => {
    sessionLlmMessages = convertToLlm(event.messages)
  })

  // The snapshot describes the branch the last request ran on; after tree
  // navigation or a session switch it no longer matches what the user sees.
  const clear = () => {
    sessionLlmMessages = undefined
  }
  pi.on('session_tree', clear)
  pi.on('session_start', clear)

  /** The agent's active tool definitions, in the order the agent sends them. */
  const sessionTools = (): Tool[] | undefined => {
    const byName = new Map(pi.getAllTools().map((t) => [t.name, t]))
    const tools: Tool[] = []
    for (const name of pi.getActiveTools()) {
      const info = byName.get(name)
      if (info)
        tools.push({ name: info.name, description: info.description, parameters: info.parameters })
    }
    return tools.length > 0 ? tools : undefined
  }

  return {
    makeFork(ctx) {
      if (!sessionLlmMessages || sessionLlmMessages.length === 0) return undefined
      // Match the session's thinking level too: on Anthropic, changing thinking
      // settings invalidates the message-level prompt cache.
      const thinking = pi.getThinkingLevel()
      return {
        systemPrompt: ctx.getSystemPrompt(),
        messages: sessionLlmMessages,
        tools: sessionTools(),
        reasoning: thinking === 'off' ? undefined : thinking
      }
    }
  }
}
