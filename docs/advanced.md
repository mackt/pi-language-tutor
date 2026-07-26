# Advanced

Deeper behavior of [pi-language-tutor](../README.md). For the happy path, start with the [README](../README.md).

## What gets reviewed

To avoid wasted tokens and noise, the review **skips**:

- slash / bang commands
- trivially short prompts
- messages that are mostly code or paths
- everything while `/lang check off` (or `/lang off`)

CJK prompts are counted by **characters**, not whitespace words, so a substantial native-language prompt still reaches the writing tutor. Reviews run only in interactive TUI mode. A failed review never disturbs your session.

## Writing check vs Writing tutor

A single LLM call inspects each prompt and picks a mode:

| Prompt language | Panel | What it does |
| --- | --- | --- |
| Learning language | `✏ Writing check` | Spelling, grammar, phrasing + native-language notes + a natural whole-sentence rewrite |
| Native (or other non-learning) language | `✏ Writing tutor` | Whole-sentence expression in the learning language, key vocabulary, and grammar |

The two are complementary and **never both fire** on the same prompt.

If you often write prompts in your native language on purpose and the tutor gets noisy, turn it off:

```text
/lang tutor off
```

Native-language prompts then show no panel; the writing check keeps working for learning-language prompts.

## Bilingual cards

- Paragraphs are **original-then-translation**, immersive-translate style.
- Short code blocks (≤5 lines) stay in the card; longer ones become `[code block ↑ N lines]` (the full code is still in the message above).
- Auto mode (`/lang auto on`) skips intermediate tool-call narration and replies under ~15 words.
- While auto is on, the status bar shows `🌐 auto`.

## Custom providers

On **pi 0.81+**, checks and translations go through the composed provider’s `streamSimple` — the same dispatch the main session uses — so custom providers work whether they were registered as a config (e.g. Cursor’s `cursor-sdk`) or as a native `Provider` object.

On **pi 0.80**, the extension falls back to pi-ai’s `completeSimple`; the global API registry there already covered custom providers.

## Context mode

```text
/lang context on     # translations see full session (off by default)
/lang check context  # writing check & tutor see conversation history
```

### Why translation context is off by default

By default a translation only sees the message being translated, so pronouns, project names, and coined terms can come out generic. Context mode **forks** the session: the translation request replays the exact prefix of the main session’s last LLM request (same tools, system prompt, and history). The provider can serve that prefix from its prompt cache, so you pay **cache-read** prices (~10% of input on Anthropic) plus the translation itself.

### Two caveats

1. **It only pays off with the session model.** A `/lang model` override cannot hit the session’s cache, so the whole history is re-billed at full input price on every translation. It also changes where your data goes: the entire conversation is sent to the override model’s provider, not just the text being translated. The extension warns about this combination at startup and when you switch; `/lang model default` fixes it.
2. **Before the first agent turn** there is no captured request yet, so translations quietly fall back to context-free.

### Check context is separate on purpose

`/lang check context` is independent of `/lang context`. The review runs on every message you send, so each reviewed message costs one cache read. Enable it only if the check keeps flagging project terms as errors — a contextual review recognizes names and coined words the session established, and the tutor can use them when teaching you how to express the message.

## Related

- [Development layout](./development.md)
- [Recording a real demo](./recording-demo.md)
