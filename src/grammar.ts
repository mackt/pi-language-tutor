/**
 * Review: watches interactive input and renders either the "✏ Writing check"
 * widget (the prompt is in the learning language — fix mistakes) or the
 * "✏ Writing tutor" widget (the prompt is in the native language — teach the
 * words, grammar, and whole-sentence expression). A single LLM call decides
 * the mode, so the two are complementary and never both fire.
 *
 * Non-blocking by design — the message reaches the agent immediately and a
 * failed review never disturbs the session.
 */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Container, Text } from '@earendil-works/pi-tui'
import { loadConfig } from './config.ts'
import type { Config, GrammarItem, ReviewResult } from './core.ts'
import { buildReviewPrompt, parseReviewResult, shouldSkipCheck } from './core.ts'
import type { ForkContext } from './llm.ts'
import { resolveModel, runLlm } from './llm.ts'
import { showTutorWidget } from './tutor.ts'

const WIDGET_KEY = 'language-learn'

export interface ReviewDeps {
  /** Fork of the main session's last LLM request (see createForkTracker). */
  makeFork(ctx: ExtensionContext): ForkContext | undefined
}

function showCheckWidget(
  ctx: ExtensionContext,
  items: GrammarItem[],
  rephrase: string | undefined
): void {
  ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => {
    const container = new Container()
    container.addChild(new Text(theme.fg('accent', theme.bold('✏ Writing check')), 1, 0))
    for (const item of items) {
      const line = `${theme.fg('error', `"${item.wrong}"`)} → ${theme.fg('success', `"${item.right}"`)}  ${theme.fg('dim', item.reason)}`
      container.addChild(new Text(line, 1, 0))
    }
    if (rephrase) {
      container.addChild(new Text(`${theme.fg('dim', '◇')} ${theme.fg('muted', rephrase)}`, 1, 0))
    }
    return container
  })
}

/** Wire up the review. Returns `disable` for the settings toggle to call. */
export function registerReview(
  pi: ExtensionAPI,
  deps: ReviewDeps
): { disable(ctx: ExtensionContext): void } {
  let abort: AbortController | undefined

  const runReview = async (
    text: string,
    cfg: Config,
    ctx: ExtensionContext,
    signal: AbortSignal
  ) => {
    try {
      const model = resolveModel(ctx, cfg)
      if (!model) return

      const attempt = async (fork?: ForkContext): Promise<ReviewResult | undefined> => {
        const raw = await runLlm(ctx, model, buildReviewPrompt(text, cfg, !!fork), signal, fork)
        if (raw === undefined) return undefined
        const parsed = parseReviewResult(raw)
        // A forked reply that isn't the review JSON (the replayed agent
        // prompt won and the model answered as the agent) is a fork failure,
        // not a clean review; context-free garbage keeps the clear-widget
        // behavior below.
        if (parsed === undefined && fork) return undefined
        return parsed ?? { mode: 'skip' }
      }

      // Context mode must be strictly additive: a fork replay can fail in
      // ways a plain request can't (the model answers with a tool call or
      // as the agent in prose, the provider rejects the replayed prefix),
      // so on failure retry context-free.
      const fork = cfg.check === 'context' ? deps.makeFork(ctx) : undefined
      let result: ReviewResult | undefined
      try {
        result = await attempt(fork)
      } catch (err) {
        if (!fork || signal.aborted) throw err
      }
      if (result === undefined && fork && !signal.aborted) result = await attempt(undefined)
      if (signal.aborted || result === undefined) return

      if (result.mode === 'skip') {
        ctx.ui.setWidget(WIDGET_KEY, undefined)
        return
      }

      if (result.mode === 'tutor') {
        // The prompt already withholds tutor mode when it is disabled; this
        // guard covers a model that returns it anyway.
        if (cfg.tutor) {
          showTutorWidget(ctx, result.tutor)
        } else {
          ctx.ui.setWidget(WIDGET_KEY, undefined)
        }
        return
      }

      // check
      const items = result.items
      const rephrase = result.rephrase ?? undefined
      if (items.length === 0 && !rephrase) {
        ctx.ui.setWidget(WIDGET_KEY, undefined)
      } else {
        showCheckWidget(ctx, items, rephrase)
      }
    } catch {
      // silent by design: a failed review must never disturb the session
    }
  }

  pi.on('input', (event, ctx) => {
    if (event.source !== 'interactive') return
    if (!ctx.hasUI || ctx.mode !== 'tui') return

    const cfg = loadConfig()
    if (cfg.check === 'off') return

    const text = event.text.trim()
    if (shouldSkipCheck(text)) return

    abort?.abort()
    abort = new AbortController()
    // Fire and forget: the message continues to the agent immediately.
    void runReview(text, cfg, ctx, abort.signal)
  })

  return {
    disable(ctx) {
      abort?.abort()
      ctx.ui.setWidget(WIDGET_KEY, undefined)
    }
  }
}
