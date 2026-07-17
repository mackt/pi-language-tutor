# pi-language-tutor

English | [简体中文](README.zh-CN.md)

Learn a foreign language while you code. A [pi](https://pi.dev) extension that reviews your prompts for spelling, grammar, and natural phrasing — with explanations in your native language — and renders agent replies as bilingual immersive translations.

<img src="docs/writing-check.png" width="720" alt="The Writing check panel: while the agent works on the prompt, each mistake is shown with its fix, an explanation in your native language, and a more natural phrasing of the whole sentence.">

*You prompt with mistakes, the agent works anyway — and the `✏ Writing check` panel explains each fix in your native language.*

## Install

```sh
pi install npm:pi-language-tutor
```

That is the only required step. The defaults (learning English, native Simplified Chinese) work out of the box. Speak another language? One command: `/lang native ja`.

<details>
<summary>Alternative: install from git, or hack on a local clone</summary>

Install straight from GitHub without npm:

```sh
pi install git:github.com/mackt/pi-language-tutor
```

Or clone and symlink into pi's global extensions directory (auto-discovered via the `pi.extensions` field in package.json, hot-reloads with `/reload`) — best for development, since there is no build step and pi loads TypeScript directly:

```sh
git clone https://github.com/mackt/pi-language-tutor.git
ln -s "$(pwd)/pi-language-tutor" ~/.pi/agent/extensions/pi-language-tutor
```

</details>

## Try this first

1. Start `pi` and send a prompt in your learning language, mistakes and all:

   ```text
   when agent anwser me, I want translate it, it have three feature
   ```

   While the agent answers, a `✏ Writing check` panel appears above the editor: each mistake with its fix and a short explanation in your native language, plus one more natural way to phrase the whole sentence.

2. When the agent finishes, press `alt+t` (macOS: ⌥T — [enable Option-as-Meta](https://iterm2.com/documentation-preferences-profiles-keys.html) in your terminal, or run `/translate`). The response re-renders as a bilingual card: each paragraph followed by its translation.

   <img src="docs/bilingual-card.png" width="720" alt="The bilingual card: each paragraph of the agent's response is followed by its translation, immersive-translate style, with code blocks kept intact.">


3. Like the bilingual view? Make it automatic:

   ```text
   /lang auto on
   ```

That is enough to start.

## What happens

- **Nothing ever blocks.** Your message goes to the agent immediately; the writing check runs in parallel and the panel appears a moment later. A clean message shows no panel at all.
- **Nothing pollutes the conversation.** Translation cards live only in your terminal — they are never sent back to the LLM and cost no context.
- **You control the spend.** Both features use your session model by default; point them at a cheaper one with `/lang model` and a one-line config change makes every check nearly free.

## Commands

| Command | What it does |
|---------|--------------|
| `alt+t` or `/translate` | Translate the last assistant response (bilingual card) |
| `/lang` | Show current settings |
| `/lang on` \| `off` | Resume / pause the writing check |
| `/lang auto on` \| `off` | Auto-translate every final response |
| `/lang native <code>` | Set your native language — translation target and explanation language (`zh-CN`, `ja`, …) |
| `/lang learning <code>` | Set the language you are practicing (`en`, `fr`, …) |
| `/lang model <provider/id>` | Use a cheaper model for checks and translations |
| `/lang model default` | Go back to the session model |

## Configuration

Settings persist in `~/.pi/agent/language-learn.json`; the `/lang` command manages everything, so you rarely edit it by hand.

```json
{
	"learning": "en",
	"native": "zh-CN",
	"model": "openai/gpt-4o-mini",
	"enabled": true,
	"auto": false
}
```

`model` is optional — when unset, the session model is used.

## Details

**What gets checked.** To avoid wasted tokens and noise, the writing check skips: slash/bang commands, messages under 4 words, messages that are mostly code or paths, messages not written in the learning language, and everything while `/lang off`. Checks run only in interactive TUI mode, and a failed check never disturbs your session.

**Bilingual cards.** Paragraphs are aligned original-then-translation, immersive-translate style. Short code blocks (≤5 lines) are kept in the card; longer ones become a `[code block ↑ N lines]` placeholder since the original sits right above. Auto mode skips intermediate tool-call narration and responses under ~15 words; the footer shows `🌐 auto` while enabled.

## Development

```sh
npm install
npm run check   # typecheck
npm test        # unit tests for the skip heuristics and response parsing
```

Layout: `src/core.ts` holds the pure logic (heuristics, prompts, parsing, card assembly — what the tests import), `src/config.ts` the config persistence, and `src/index.ts` the pi adapter (the only file that imports pi packages). `language-learn.ts` is the entry point re-exporting both.
