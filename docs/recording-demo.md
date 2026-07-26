# Recording a live demo

The README hero currently uses `docs/demo.gif`: a short slideshow of the three product panels (check, tutor, bilingual). That is enough for scanning; a **real terminal recording** feels more premium once you have one.

## What to capture

Aim for **12–20 seconds**, one continuous take:

1. Type a learning-language prompt with a couple of mistakes → `✏ Writing check` appears while the agent works.
2. Type a native-language prompt → `✏ Writing tutor` appears.
3. After a reply, press `alt+t` → bilingual card.

Use a dark theme, large font, and a clean prompt history so labels stay readable at 720px width.

## Suggested tooling (macOS)

- [asciinema](https://asciinema.org/) + `agg` / `asciinema-gif` for terminal-native GIF, or
- [VHS](https://github.com/charmbracelet/vhs) if you prefer a scripted tape, or
- QuickTime / Cap + ffmpeg if you already have a window recording.

Example post-process to a lean GIF:

```sh
ffmpeg -i demo.mov -vf "fps=12,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 docs/demo.gif
```

Keep the file under ~1.5 MB so GitHub’s README stays snappy.

## After replacing

1. Drop the new file at `docs/demo.gif` (or update the README `src` if you rename it).
2. Prefer a real `docs/writing-tutor.png` capture over the HTML mock in `docs/_shots/`.
3. Keep EN / zh READMEs pointing at the same absolute raw.githubusercontent.com URLs (npm does not render relative images).
