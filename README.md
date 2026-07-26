<p align="center">
  <img src="https://raw.githubusercontent.com/mackt/pi-language-tutor/main/docs/logo.png" width="96" height="96" alt="pi-language-tutor logo" />
</p>

# pi-language-tutor

<p align="center">
  <strong>Learn a foreign language while you code.</strong><br />
  A <a href="https://pi.dev">pi</a> extension that reviews your prompts, teaches you how to say what you couldn’t yet, and turns agent replies into bilingual immersive translations.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pi-language-tutor"><img src="https://img.shields.io/npm/v/pi-language-tutor" alt="npm" /></a>
  <a href="https://github.com/mackt/pi-language-tutor/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/mackt/pi-language-tutor/ci.yml?branch=main&label=CI" alt="CI" /></a>
  <a href="https://github.com/mackt/pi-language-tutor/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/pi-language-tutor" alt="license" /></a>
  <a href="https://www.npmjs.com/package/pi-language-tutor"><img src="https://img.shields.io/npm/dw/pi-language-tutor" alt="downloads" /></a>
  <a href="https://github.com/mackt/pi-language-tutor"><img src="https://img.shields.io/github/stars/mackt/pi-language-tutor" alt="stars" /></a>
</p>

<p align="center">
  English · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mackt/pi-language-tutor/main/docs/demo.gif" width="720" alt="Demo: Writing check, Writing tutor, and bilingual translation panels" />
</p>

## Install

```sh
pi install npm:pi-language-tutor
```

That’s the only required step. Defaults (learning English, native Simplified Chinese) work out of the box. Another language? Type `/lang` or run `/lang native ja`.

<details>
<summary>Alternative: install from git, or hack on a local clone</summary>

```sh
pi install git:github.com/mackt/pi-language-tutor
```

Or symlink a clone into pi’s global extensions directory (auto-discovered via `pi.extensions`, hot-reloads with `/reload`):

```sh
git clone https://github.com/mackt/pi-language-tutor.git
ln -s "$(pwd)/pi-language-tutor" ~/.pi/agent/extensions/pi-language-tutor
```

</details>

## Features

### ✏ Writing check

Prompt in the language you’re learning. While the agent works, a panel explains each mistake in your **native** language — fix, why, and a more natural whole sentence.

<img src="https://raw.githubusercontent.com/mackt/pi-language-tutor/main/docs/writing-check.png" width="720" alt="Writing check panel explaining mistakes in the native language while the agent continues working" />

### ✏ Writing tutor

Prompt in your **native** language because the thought came faster that way. The tutor teaches the natural whole-sentence form in the learning language, the key words, and the grammar that carries it.

<img src="https://raw.githubusercontent.com/mackt/pi-language-tutor/main/docs/writing-tutor.png" width="720" alt="Writing tutor panel: whole-sentence English, vocabulary notes, and grammar for a Chinese prompt" />

### 🌐 Bilingual cards

After a reply, press `alt+t` (macOS: ⌥T) or run `/translate`. Each paragraph is followed by its translation — immersive-translate style, with short code blocks kept intact.

<img src="https://raw.githubusercontent.com/mackt/pi-language-tutor/main/docs/bilingual-card.png" width="720" alt="Bilingual card: each English paragraph followed by its Chinese translation" />

## Try this first

1. Start `pi` and send a prompt in your learning language:

   ```text
   when agent anwser me, I want translate it, it have three feature
   ```

   The agent answers as usual. A `✏ Writing check` panel appears above the editor with fixes and native-language explanations.

2. Write a prompt in your **native** language instead:

   ```text
   我想重构这个函数但是不知道怎么下手
   ```

   A `✏ Writing tutor` panel appears: a natural whole-sentence rendering, key vocabulary, and grammar.

3. When the agent finishes, press `alt+t` (on macOS, [enable Option-as-Meta](https://iterm2.com/documentation-preferences-profiles-keys.html) in your terminal, or run `/translate`). The reply re-renders as a bilingual card.

4. Prefer auto-translate on every final response?

   ```text
   /lang auto on
   ```

That’s enough to start.

## Design principles

| | |
| --- | --- |
| **Nothing ever blocks** | Your message goes to the agent immediately; the review runs in parallel. A clean message shows no panel at all. |
| **Two panels, never both** | Learning language → Writing check. Native language → Writing tutor. One LLM call decides — they never both fire. |
| **Nothing pollutes the conversation** | Translation cards live only in your terminal — never sent back to the LLM, no context cost. |
| **You control the spend** | Features use your session model by default; point them at a cheaper one with `/lang model`. |

## Settings

Type `/lang` for the interactive menu, or set options directly:

| Command | What it does |
| --- | --- |
| `/translate` or `alt+t` | Translate the last assistant response |
| `/lang` | Interactive settings menu |
| `/lang check off` \| `on` \| `context` | Writing check & tutor mode (`context` sees the conversation; `/lang on`/`off` still work) |
| `/lang tutor on` \| `off` | Keep / drop the writing tutor alone |
| `/lang auto on` \| `off` | Auto-translate every final response |
| `/lang native <code>` | Native language — translations & explanations (`zh-CN`, `ja`, …) |
| `/lang learning <code>` | Language you’re practicing (`en`, `fr`, …) |
| `/lang model [model]` | Model for this extension |
| `/lang model default` | Follow the session model |
| `/lang context on` \| `off` | Translations with full session context (off by default) |

## Configuration

Settings persist in `~/.pi/agent/language-learn.json`.

```json
{
  "learning": "en",
  "native": "zh-CN",
  "model": "openai/gpt-4o-mini",
  "check": "on",
  "tutor": true,
  "auto": false,
  "context": false
}
```

`model` defaults to the session model. `tutor` defaults to on.

## Advanced

Skip heuristics, check vs tutor rules, bilingual card details, custom providers, and context-mode cost trade-offs:

→ **[docs/advanced.md](docs/advanced.md)**

## Development

```sh
npm install
npm run check   # typecheck
npm test        # unit tests
```

Layout, scripts, and how product screenshots are produced:

→ **[docs/development.md](docs/development.md)**

Contributions welcome via PR. Conventions live in [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)
