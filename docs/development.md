# Development

Working on [pi-language-tutor](../README.md) from a local clone.

## Setup

```sh
git clone https://github.com/mackt/pi-language-tutor.git
cd pi-language-tutor
npm install
ln -s "$(pwd)" ~/.pi/agent/extensions/pi-language-tutor
```

There is no build step: pi loads TypeScript directly via the `pi.extensions` field in `package.json`. After edits, run `/reload` in the TUI.

## Scripts

```sh
npm run check      # typecheck (tsc --noEmit)
npm test           # unit tests (vitest): core behavior and flashcard scheduling
npm run lint       # oxlint
npm run fmt        # oxfmt
npm run fmt:check  # format check (CI)
```

`npm run check`, `npm test`, `npm run lint`, and `npm run fmt:check` must all pass before opening a PR (see [AGENTS.md](../AGENTS.md)).

## Layout

| Path                        | Role                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/core.ts`               | Pure logic: heuristics, prompts, parsing, card assembly. **Zero pi imports** — the unit-test surface |
| `src/config.ts`             | Config load/save (`~/.pi/agent/language-learn.json`)                                                 |
| `src/llm.ts`                | Model resolution, LLM calls, session-fork tracking                                                   |
| `src/grammar.ts`            | Unified review: writing check + writing tutor dispatch                                               |
| `src/tutor.ts`              | Writing tutor renderer                                                                               |
| `src/translate.ts`          | Bilingual cards                                                                                      |
| `src/flashcards.ts`         | Flashcard persistence and FSRS scheduling                                                            |
| `src/flashcard-settings.ts` | Flashcard review settings                                                                            |
| `src/learn.ts`              | `/flashcards` review-window controller                                                               |
| `src/settings.ts`           | `/lang` command and interactive menu                                                                 |
| `src/index.ts`              | Composition root                                                                                     |
| `web/flashcards.html`       | Self-contained flashcard review UI                                                                   |
| `types/glimpseui.d.ts`      | Local type declarations for the review-window dependency                                             |
| `language-learn.ts`         | Package entry: re-exports core + default extension export                                            |

Feature modules keep one-way dependencies; new logic that does not need pi APIs goes in `core.ts`.

## Product screenshots

| Asset                     | Notes                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `docs/writing-check.png`  | Real terminal capture                                                                             |
| `docs/bilingual-card.png` | Real terminal capture                                                                             |
| `docs/writing-tutor.png`  | Real terminal capture (HTML mock in `docs/_shots/writing-tutor.html` kept as a fallback template) |
| `docs/demo.gif`           | Slideshow of the three panels for the README hero                                                 |
| `docs/logo.png`           | 256×256 logo for README header                                                                    |
| `docs/icon.png`           | Full app icon source                                                                              |

Regenerate the tutor mock:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1642,1169 \
  --screenshot="$(pwd)/docs/writing-tutor.png" \
  "file://$(pwd)/docs/_shots/writing-tutor.html"
```

To replace the hero with a live terminal recording, see [recording-demo.md](./recording-demo.md).

## Related

- [Advanced behavior](./advanced.md)
- [AGENTS.md](../AGENTS.md) — branch, commit, and release conventions
