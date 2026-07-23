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
import { matchModelReference } from './core.ts'
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

/** Narrow registry surface used by {@link getProviderStreamSimple} (testable). */
export type StreamSimpleRegistry = {
  getRegisteredProviderConfig(
    provider: string
  ): { api?: string; streamSimple?: StreamSimpleFn } | undefined
}

/**
 * Prefer a provider-registered `streamSimple` over the global `completeSimple`
 * registry. Custom providers (e.g. `cursor-sdk`) register their handler on the
 * provider config; `completeSimple` only knows built-in api ids and throws
 * `No API provider registered for api: …` for those models.
 */
export function getProviderStreamSimple(
  modelRegistry: StreamSimpleRegistry,
  model: Pick<ResolvedModel, 'provider' | 'api'>
): StreamSimpleFn | undefined {
  const config = modelRegistry.getRegisteredProviderConfig(model.provider)
  if (!config?.streamSimple) return undefined
  // Only use the custom handler when it owns this model's api id.
  if (config.api !== undefined && config.api !== model.api) return undefined
  return config.streamSimple
}

/**
 * pi 0.80 registered extension `streamSimple` into the global api registry, so
 * `completeSimple` worked for custom apis. pi 0.81 moved that handler onto the
 * provider config (`getRegisteredProviderConfig`) and stopped calling
 * `registerApiProvider`, which breaks side-calls for apis like `cursor-sdk`.
 * Prefer the provider handler when the method exists; otherwise fall back.
 */
async function completeWithModel(
  ctx: ExtensionContext,
  model: ResolvedModel,
  context: Context,
  options: SimpleStreamOptions
): Promise<AssistantMessage> {
  const registry = ctx.modelRegistry as ExtensionContext['modelRegistry'] &
    Partial<StreamSimpleRegistry>
  if (typeof registry.getRegisteredProviderConfig === 'function') {
    const providerStream = getProviderStreamSimple(
      { getRegisteredProviderConfig: (id) => registry.getRegisteredProviderConfig!(id) },
      model
    )
    if (providerStream) {
      return providerStream(model, context, options).result()
    }
  }
  return completeSimple(model, context, options)
}

/** The model to use for checks and translations: the configured override, else the session model. */
export function resolveModel(ctx: ExtensionContext, cfg: Config): ResolvedModel | undefined {
  if (cfg.model && cfg.model !== 'default') {
    // /lang model saves canonical provider/id, but a hand-edited config may
    // hold a bare id; match both the way pi's own resolver does. Matching
    // configured-auth models first keeps a bare id unambiguous when other
    // providers' catalogs also list it.
    const available = matchModelReference(cfg.model, ctx.modelRegistry.getAvailable())
    if (available.kind === 'found') return available.model
    // An override that exists in the catalog but lost its auth (/logout, env
    // var removed) must fail the side-call visibly in runLlm — not silently
    // re-route translations, and the conversation data, to the session
    // model's provider.
    const catalog = matchModelReference(cfg.model, ctx.modelRegistry.getAll())
    if (catalog.kind === 'found') return catalog.model
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
  if (!auth.ok || !auth.apiKey) return undefined

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
