# pi-language-tutor

English | [简体中文](README.zh-CN.md)

A [pi](https://pi.dev) extension for practicing a foreign language while you code.

- **Writing feedback** — prompts you type in your learning language are reviewed in the background (never blocking the agent) for spelling, grammar, and natural phrasing. Corrections appear in a widget above the editor, with short explanations in your native language and, when your phrasing sounds non-native, one more natural way to say it. The widget disappears when your message is clean.
- **Bilingual translate** — press `alt+t` (or run `/translate`) to render the last assistant response as an immersive-translate-style bilingual card: each original paragraph followed by its translation as a blockquote. Short code blocks (≤5 lines) are kept in the card; longer ones become a `[code block ↑ N lines]` placeholder since the original sits right above. Cards are never sent to the LLM.
- **Auto mode** — `/lang auto on` translates the final response of every turn automatically (intermediate tool-call narration is skipped, as are responses under ~15 words). The footer shows `🌐 auto` while enabled and `translating…` while a translation is running.
- **Cheap by default** — both features use the session model unless you point them at a cheaper one with `/lang model`.

## Install

Symlink the extension into pi's global extensions directory (auto-discovered, hot-reloads with `/reload`):

```sh
ln -s "$(pwd)/language-learn.ts" ~/.pi/agent/extensions/language-learn.ts
```

Or add it to `~/.pi/agent/settings.json`:

```json
{ "extensions": ["/path/to/pi-learn-foreign-language/language-learn.ts"] }
```

No build step — pi loads TypeScript directly.

## Configure

Settings live in `~/.pi/agent/language-learn.json` and are managed with the `/lang` command:

```
/lang                      show current settings
/lang on | off             pause/resume the writing check
/lang auto on | off        auto-translate every response (bilingual card)
/lang native ja            set your native language (translation target + explanation language)
/lang learning fr          set the language you are practicing
/lang model openai/gpt-4o-mini   use a cheaper model for checks/translations
/lang model default        use the session model
```

Defaults: `learning=en`, `native=zh-CN`, session model, `auto=off`.

## What gets checked

To avoid wasted tokens and noise, the writing check skips: slash/bang commands, messages under 4 words, messages that are mostly code or paths, messages not written in the learning language, and everything while `/lang off`. Checks run only in interactive TUI mode, and a failed check never disturbs your session.

## Development

```sh
npm install
npm run check   # typecheck
npm test        # unit tests for the skip heuristics and response parsing
```
