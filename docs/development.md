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
npm test           # unit tests (vitest): skip heuristics, parsing, pure logic
npm run lint       # oxlint
npm run fmt        # oxfmt
npm run fmt:check  # format check (CI)
```

`npm run check` and `npm test` must both pass before opening a PR (see [AGENTS.md](../AGENTS.md)).

## Layout

| Path | Role |
| --- | --- |
| `src/core.ts` | Pure logic: heuristics, prompts, parsing, card assembly. **Zero pi imports** — the unit-test surface |
| `src/config.ts` | Config load/save (`~/.pi/agent/language-learn.json`) |
| `src/llm.ts` | Model resolution, LLM calls, session-fork tracking |
| `src/grammar.ts` | Unified review: writing check + writing tutor dispatch |
| `src/tutor.ts` | Writing tutor renderer |
| `src/translate.ts` | Bilingual cards |
| `src/settings.ts` | `/lang` command and interactive menu |
| `src/index.ts` | Composition root |
| `language-learn.ts` | Package entry: re-exports core + default extension export |

Feature modules keep one-way dependencies; new logic that does not need pi APIs goes in `core.ts`.

## Product screenshots

| Asset | Notes |
| --- | --- |
| `docs/writing-check.png` | Real terminal capture |
| `docs/bilingual-card.png` | Real terminal capture |
| `docs/writing-tutor.png` | Product-style mock (HTML in `docs/_shots/writing-tutor.html`) until a real capture is swapped in |
| `docs/demo.gif` | Slideshow of the three panels for the README hero |
| `docs/logo.png` | 256×256 logo for README header |
| `docs/icon.png` | Full app icon source |
| `docs/icon-v3.svg` | Vector mark |

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
