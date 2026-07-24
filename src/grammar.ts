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
import type { Config, GrammarItem } from './core.ts'
import { buildReviewPrompt, parseReviewResult, shouldSkipCheck } from './core.ts'
import { resolveModel, runLlm } from './llm.ts'
import { showTutorWidget } from './tutor.ts'

const WIDGET_KEY = 'language-learn'

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
export function registerReview(pi: ExtensionAPI): { disable(ctx: ExtensionContext): void } {
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

      const raw = await runLlm(ctx, model, buildReviewPrompt(text, cfg), signal)
      if (signal.aborted || raw === undefined) return

      const result = parseReviewResult(raw)
      if (!result || result.mode === 'skip') {
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
    if (!cfg.enabled) return

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
