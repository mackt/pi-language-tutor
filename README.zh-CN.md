# pi-language-tutor

[English](README.md) | 简体中文

一边 coding 一边学外语。这是一个 [pi](https://pi.dev) 扩展：检查你 prompt 里的拼写和语法并用母语讲解错在哪；当你用母语写下还不会用学习语言表达的句子时，教你怎么说——给出整句地道说法、关键词汇和语法点；还能把 agent 的回复渲染成沉浸式翻译那样的双语对照。

<img src="https://raw.githubusercontent.com/mackt/pi-language-tutor/main/docs/writing-check.png" width="720" alt="Writing check 面板：agent 照常处理 prompt 的同时，每个错误都给出改法、中文解释，以及整句更地道的说法。">

## 安装

```sh
pi install npm:pi-language-tutor
```

默认配置开箱即用：学英语、母语简体中文。母语是其他语言的话，输入 `/lang` 在设置菜单里选，或者一条命令切换：`/lang native ja`。

<details>
<summary>备选：从 git 安装，或本地开发</summary>

也可以不走 npm，直接从 GitHub 安装：

```sh
pi install git:github.com/mackt/pi-language-tutor
```

本地开发推荐克隆仓库后软链接到 pi 的全局扩展目录（pi 会通过 package.json 的 `pi.extensions` 字段自动发现，改完 `/reload` 热重载）。没有构建步骤，pi 直接加载 TypeScript：

```sh
git clone https://github.com/mackt/pi-language-tutor.git
ln -s "$(pwd)/pi-language-tutor" ~/.pi/agent/extensions/pi-language-tutor
```

</details>

## 快速上手

1. 启动 `pi`，用你正在学的语言发条 prompt：

   ```text
   when agent anwser me, I want translate it, it have three feature
   ```

   agent 照常回答；与此同时编辑器上方会出现 `✏ Writing check` 面板，列出每处错误的改法和中文讲解，最后还有一句整体更地道的表达。

2. 换成用**母语**写 prompt——可能是因为这么想更快，也可能是因为还不会用学习语言表达：

   ```text
   我想重构这个函数但是不知道怎么下手
   ```

   这次出现的是 `✏ Writing tutor` 面板：先给你一句地道的学习语言整句表达，再列出关键的新词（每个都用母语讲解——意思、用法、为什么选这个词而不是别的），最后是这句话里的语法点。一个面板把你不会说的那句话讲明白。

3. agent 回答完，按 `alt+t`（macOS 上是 ⌥T，需要在终端里[把 Option 设为 Meta 键](https://iterm2.com/documentation-preferences-profiles-keys.html)；也可以直接运行 `/translate`）。回复会重新渲染成双语卡片，每个原文段落下面紧跟译文。

   <img src="https://raw.githubusercontent.com/mackt/pi-language-tutor/main/docs/bilingual-card.png" width="720" alt="双语卡片：agent 回复的每个段落下面紧跟译文，沉浸式翻译风格，代码块原样保留。">

4. 觉得双语对照好用，可以让每条回复自动翻译：

   ```text
   /lang auto on
   ```

   到这里就够用了。

## 工作机制

- **绝不阻塞。** 消息照常立刻发给 agent，检查在后台并行跑，面板稍后才出现；没写错就什么都不显示。
- **两个互补的面板，不会同时出现。** 用学习语言写 → `✏ Writing check` 帮你改错。用母语写 → `✏ Writing tutor` 教你词汇、语法和整句表达。一次 LLM 调用决定走哪个分支，二者绝不会同时触发。
- **绝不污染对话。** 翻译卡片只显示在你的终端里，不会发回给 LLM，也不占上下文。
- **花费你说了算。** 所有功能默认用当前会话的模型；用 `/lang model` 换个便宜模型，每次检查的成本就小到可以忽略。

## 设置

在 TUI 中输入 `/lang` 打开交互式设置菜单，也可以用下面的命令直接设置。

| 命令                                   | 作用                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| `/translate` 或 `alt+t`                | 翻译 agent 回复（双语卡片）                                                           |
| `/lang`                                | 打开交互式设置菜单，每个选项都有一行说明                                              |
| `/lang check off` \| `on` \| `context` | 检查与辅导的模式——`context` 让检查能看到会话内容（`/lang on`/`off` 仍可作为快捷开关） |
| `/lang tutor on` \| `off`              | 单独开关写作辅导（关闭后母语消息不再显示面板）                                        |
| `/lang auto on` \| `off`               | 自动翻译每轮最终回复                                                                  |
| `/lang native <code>`                  | 设置母语，即译文和讲解使用的语言（`zh-CN`、`ja`…）                                    |
| `/lang learning <code>`                | 设置正在学习的语言（`en`、`fr`…）                                                     |
| `/lang model [model]`                  | 指定本插件使用的模型                                                                  |
| `/lang model default`                  | 换回会话模型                                                                          |
| `/lang context on` \| `off`            | 翻译时携带完整会话上下文（默认关闭，详见下文）                                        |

## 配置

配置保存在 `~/.pi/agent/language-learn.json`。

```json
{
  "learning": "en",
  "native": "zh-CN",
  "model": "openai/gpt-4o-mini",
  "check": "on",
  "auto": false,
  "context": false
}
```

`model` 默认用当前会话的模型。

## 更多细节

**哪些消息会被检查。** 为了省 token、少打扰，以下消息不会触发检查：斜杠/感叹号命令、过短的消息、以代码或路径为主的消息，以及 `/lang off` 期间的所有输入。CJK 文本按字符数计算（而不是按空格分词），所以用母语写的一整句仍然会进入写作辅导。检查只在交互式 TUI 里运行；就算检查失败，也不会影响你的会话。

**Writing check 与 Writing tutor。** 每条消息只发一次 LLM 调用，由模型选择模式。如果消息是学习语言写的，检查拼写、语法和表达（`✏ Writing check` 面板）。如果消息是母语写的——也就是说你还不会用学习语言表达——就改为教学（`✏ Writing tutor` 面板）：一句地道的整句表达，需要学的关键词汇（每个都用母语讲解），以及句中的语法结构。两者互补，绝不会在同一条消息上同时出现。如果你本来就习惯用母语写 prompt、觉得辅导面板太吵，`/lang tutor off` 可以恢复只做检查的行为——母语消息不再显示任何面板，写作检查照常工作。

**双语卡片。** 段落按「原文在上、译文在下」排列，和沉浸式翻译一个风格。短代码块（≤5 行）原样保留，更长的用 `[code block ↑ N lines]` 占位——完整代码就在上方的原文里。自动模式下，中间的工具调用叙述和少于 15 个词的回复不会翻译；开启时底部状态栏会显示 `🌐 auto`。

**自定义 provider。** 在 pi 0.81+ 上，写作检查和翻译直接走组合 provider 的 `streamSimple`——与主会话完全相同的分发路径——因此无论 provider 是以配置形式注册（如 Cursor 的 `cursor-sdk`）还是以原生 `Provider` 对象注册，都能正常工作。pi 0.80 上则回落到 pi-ai 的 `completeSimple`，那里的全局 api registry 本就覆盖自定义 provider。

**上下文模式**（`/lang context on`，默认关闭）。默认情况下翻译只能看到被翻译的那条消息，代词指代、项目名、会话里约定的术语都可能译得很泛。上下文模式改为从主会话「fork」出翻译请求：完整复用主会话上一次 LLM 请求的前缀（相同的工具定义、系统提示词和消息历史），这样整段历史都能命中服务商的 prompt cache，你只需付缓存读取的价格（Anthropic 约为正常输入价的 10%）加上翻译本身的开销。两点注意：

- 只有翻译使用**会话模型**时才划算——用 `/lang model` 指定了别的模型就无法命中主会话的缓存，每次翻译都会按全价重新计费整段历史。这也会改变数据的去向：指定其他模型后，发给该服务商的是整段对话，而不只是被翻译的文本。扩展会在启动和切换模型时对这种组合发出提醒；运行 `/lang model default` 即可解决。
- 会话第一轮 agent 对话之前还没有可复用的请求，此时翻译会静默回退到无上下文模式。

写作检查与辅导有自己独立的上下文档位（`/lang check context`），刻意不与翻译共用开关：检查在你发出的每条消息上都会触发，开启后每次检查都要付一次缓存读取。只有当检查总把项目术语误报成错误时才值得打开——带上下文的检查能认出会话里约定的名称和造词，辅导教你表达时也会优先用它们。

## 开发

```sh
npm install
npm run check   # 类型检查
npm test        # 单元测试：跳过判定和回复解析
```

目录结构：`src/core.ts` 放纯逻辑（跳过判定、prompt、解析、卡片拼装，测试只依赖这个文件，不 import 任何 pi 包），`src/config.ts` 负责配置读写。pi 适配层按特性拆分：`src/llm.ts`（模型解析、LLM 调用、会话 fork 捕获）、`src/grammar.ts`（统一的检查入口：分发 Writing check 与 Writing tutor）、`src/tutor.ts`（写作辅导的渲染）、`src/translate.ts`（双语卡片）、`src/settings.ts`（`/lang` 命令和设置菜单），`src/index.ts` 是组装根，把它们接到 pi 上。`language-learn.ts` 是入口，重新导出核心模块。
