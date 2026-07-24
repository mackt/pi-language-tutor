/**
 * Writing tutor: the renderer for the "✏ Writing tutor" widget — the sibling
 * of "✏ Writing check". When the student writes a prompt in their native
 * language (they couldn't express it in the learning language), this teaches
 * them the words, grammar, and whole-sentence expression for that thought.
 *
 * The review dispatch (which mode to render) lives in grammar.ts; this module
 * only renders the tutor payload.
 */

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Container, Text } from '@earendil-works/pi-tui'
import type { TutorResult } from './core.ts'

const WIDGET_KEY = 'language-learn'

export function showTutorWidget(ctx: ExtensionContext, tutor: TutorResult): void {
  ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => {
    const container = new Container()
    container.addChild(new Text(theme.fg('accent', theme.bold('✏ Writing tutor')), 1, 0))

    // Whole-sentence expression — the natural way to say the whole thought.
    if (tutor.sentence) {
      container.addChild(
        new Text(`${theme.fg('dim', '◇')} ${theme.fg('success', tutor.sentence)}`, 1, 0)
      )
    }

    // Key vocabulary — each word with a short note in the native language.
    if (tutor.words.length > 0) {
      container.addChild(new Text(theme.fg('muted', 'Words'), 1, 0))
      for (const w of tutor.words) {
        container.addChild(
          new Text(`${theme.fg('accent', w.word)}  ${theme.fg('dim', w.note)}`, 1, 0)
        )
      }
    }

    // Grammar — the structures carrying the sentence, each explained.
    if (tutor.grammar.length > 0) {
      container.addChild(new Text(theme.fg('muted', 'Grammar'), 1, 0))
      for (const g of tutor.grammar) {
        container.addChild(
          new Text(`${theme.fg('accent', g.structure)}  ${theme.fg('dim', g.note)}`, 1, 0)
        )
      }
    }

    return container
  })
}

/** Hide the tutor widget (shared widget key with the check). */
export function hideTutorWidget(ctx: ExtensionContext): void {
  ctx.ui.setWidget(WIDGET_KEY, undefined)
}
