# 开发

在本地改 [pi-language-tutor](../README.zh-CN.md)。

## 环境

```sh
git clone https://github.com/mackt/pi-language-tutor.git
cd pi-language-tutor
npm install
ln -s "$(pwd)" ~/.pi/agent/extensions/pi-language-tutor
```

没有构建步骤：pi 通过 package.json 的 `pi.extensions` 直接加载 TypeScript。改完后在 TUI 里 `/reload` 即可。

## 脚本

```sh
npm run check      # 类型检查（tsc --noEmit）
npm test           # 单元测试（vitest）：跳过判定、解析、纯逻辑
npm run lint       # oxlint
npm run fmt        # oxfmt
npm run fmt:check  # 格式检查（CI）
```

开 PR 前 `npm run check` 与 `npm test` 都必须通过（见 [AGENTS.md](../AGENTS.md)）。

## 目录

| 路径 | 职责 |
| --- | --- |
| `src/core.ts` | 纯逻辑：跳过判定、prompt、解析、卡片拼装。**不 import 任何 pi 包**——单元测试只依赖它 |
| `src/config.ts` | 配置读写（`~/.pi/agent/language-learn.json`） |
| `src/llm.ts` | 模型解析、LLM 调用、会话 fork 捕获 |
| `src/grammar.ts` | 统一检查入口：分发 Writing check 与 Writing tutor |
| `src/tutor.ts` | 写作辅导渲染 |
| `src/translate.ts` | 双语卡片 |
| `src/settings.ts` | `/lang` 命令与设置菜单 |
| `src/index.ts` | 组装根 |
| `language-learn.ts` | 包入口：导出 core + 默认扩展 |

特性模块保持单向依赖；不需要 pi API 的新逻辑放进 `core.ts`。

## 产品图

| 资源 | 说明 |
| --- | --- |
| `docs/writing-check.png` | 真实终端截图 |
| `docs/bilingual-card.png` | 真实终端截图 |
| `docs/writing-tutor.png` | 产品风格 mock（源文件 `docs/_shots/writing-tutor.html`），有真机截图后可替换 |
| `docs/demo.gif` | 三块面板轮播，供 README 门面使用 |
| `docs/logo.png` | 256×256，README 标题用 |
| `docs/icon.png` | 完整 app icon 源图 |
| `docs/icon-v3.svg` | 矢量标 |

重新生成 tutor mock：

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1642,1169 \
  --screenshot="$(pwd)/docs/writing-tutor.png" \
  "file://$(pwd)/docs/_shots/writing-tutor.html"
```

若要用真实终端录屏替换门面 GIF，见 [recording-demo.md](./recording-demo.md)。

## 相关

- [进阶说明](./advanced.zh-CN.md)
- [AGENTS.md](../AGENTS.md) — 分支、提交与发版约定
