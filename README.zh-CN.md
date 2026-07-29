# pi-language-tutor

<p align="center">
  <strong>一边 coding 一边学外语。</strong><br />
  这是一个 <a href="https://pi.dev">pi</a> 扩展：检查你的 prompt、在你退回母语时教你怎么说、把新词存成记忆卡片，并将 agent 的回复变成沉浸式双语对照。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pi-language-tutor"><img src="https://img.shields.io/npm/v/pi-language-tutor" alt="npm" /></a>
  <a href="https://github.com/mackt/pi-language-tutor/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/mackt/pi-language-tutor/ci.yml?branch=main&label=CI" alt="CI" /></a>
  <a href="https://github.com/mackt/pi-language-tutor/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/pi-language-tutor" alt="license" /></a>
  <a href="https://www.npmjs.com/package/pi-language-tutor"><img src="https://img.shields.io/npm/dw/pi-language-tutor" alt="downloads" /></a>
  <a href="https://github.com/mackt/pi-language-tutor"><img src="https://img.shields.io/github/stars/mackt/pi-language-tutor" alt="stars" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> · 简体中文
</p>

## 安装

```sh
pi install npm:pi-language-tutor
```

只需这一步。默认配置开箱即用：学英语、母语简体中文。其他语言输入 `/lang`，或直接 `/lang native ja`。

<details>
<summary>备选：从 git 安装，或本地开发</summary>

```sh
pi install git:github.com/mackt/pi-language-tutor
```

也可以克隆后软链接到 pi 的全局扩展目录（通过 `pi.extensions` 自动发现，`/reload` 热重载）：

```sh
git clone https://github.com/mackt/pi-language-tutor.git
ln -s "$(pwd)/pi-language-tutor" ~/.pi/agent/extensions/pi-language-tutor
```

</details>

## 功能

### ✏ Writing check

用你正在学的语言写 prompt。agent 照常工作时，面板用**母语**讲清每一处错误——改法、原因，以及整句更地道的说法。

<img src="https://raw.githubusercontent.com/mackt/pi-language-tutor/main/docs/writing-check.png" width="720" alt="Writing check 面板：agent 继续工作时，用母语解释每处错误" />

### ✏ Writing tutor

想法来得太快、先用**母语**写下 prompt。辅导面板教你学习语言里的整句地道表达、关键词汇和承载这句话的语法。

<img src="https://raw.githubusercontent.com/mackt/pi-language-tutor/main/docs/writing-tutor.png" width="720" alt="Writing tutor 面板：整句英语、词汇与语法，对应中文 prompt" />

### 🗂 记忆卡片

Writing tutor 教过的单词会自动保存。运行 `/flashcards`，像用 Anki 一样复习；FSRS 会安排每张卡片再次出现的时间。

### 🌐 双语卡片

agent 回复后按 `alt+t`（macOS 上是 ⌥T）或运行 `/translate`。每个段落下面紧跟译文——沉浸式翻译风格，短代码块原样保留。

<img src="https://raw.githubusercontent.com/mackt/pi-language-tutor/main/docs/bilingual-card.png" width="720" alt="双语卡片：每个英文段落后跟中文译文" />

## 快速上手

1. 启动 `pi`，用你正在学的语言发一条 prompt：

   ```text
   when agent anwser me, I want translate it, it have three feature
   ```

   agent 照常回答；编辑器上方会出现 `✏ Writing check` 面板，给出改法和母语讲解。

2. 换成用**母语**写：

   ```text
   我想重构这个函数但是不知道怎么下手
   ```

   这次出现 `✏ Writing tutor`：整句地道表达、关键词汇和语法点。

3. 辅导中的单词已经存成记忆卡片。运行 `/flashcards`，查看答案后按 Again / Hard / Good / Easy 评价记忆情况。

4. agent 回答完，按 `alt+t`（macOS 需在终端里[把 Option 设为 Meta](https://iterm2.com/documentation-preferences-profiles-keys.html)，也可直接 `/translate`）。回复会渲染成双语卡片。

5. 想每条最终回复都自动翻译？

   ```text
   /lang auto on
   ```

到这里就够用了。

## 设计原则

|                            |                                                                              |
| -------------------------- | ---------------------------------------------------------------------------- |
| **绝不阻塞**               | 消息立刻发给 agent，检查在后台并行；没写错就不显示面板。                     |
| **两个面板，不会同时出现** | 学习语言 → Writing check；母语 → Writing tutor。一次调用决定，绝不同时触发。 |
| **绝不污染对话**           | 翻译卡片只存在于终端——不会发回 LLM，也不占上下文。                           |
| **花费你说了算**           | 默认用会话模型；用 `/lang model` 换成便宜模型即可。                          |

## 设置

输入 `/lang` 打开交互菜单，或直接用命令：

| 命令                                   | 作用                                                            |
| -------------------------------------- | --------------------------------------------------------------- |
| `/translate` 或 `alt+t`                | 翻译上一条 assistant 回复                                       |
| `/flashcards`                          | 复习 Writing tutor 自动捕获的记忆卡片                           |
| `/lang`                                | 交互式设置菜单                                                  |
| `/lang check off` \| `on` \| `context` | 检查与辅导模式（`context` 能看到会话；`/lang on`/`off` 仍可用） |
| `/lang tutor on` \| `off`              | 单独开关写作辅导                                                |
| `/lang auto on` \| `off`               | 自动翻译每轮最终回复                                            |
| `/lang native <code>`                  | 母语——译文与讲解语言（`zh-CN`、`ja`…）                          |
| `/lang learning <code>`                | 正在练习的语言（`en`、`fr`…）                                   |
| `/lang model [model]`                  | 本扩展使用的模型                                                |
| `/lang model default`                  | 跟随会话模型                                                    |
| `/lang context on` \| `off`            | 翻译时携带完整会话上下文（默认关闭）                            |

## 配置

配置保存在 `~/.pi/agent/language-learn.json`。

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

`model` 默认跟随会话模型。`tutor` 默认开启。

记忆卡片保存在 `~/.pi/agent/flashcards.json`；复习数量限制和 FSRS 目标记忆保留率保存在 `~/.pi/agent/flashcards-settings.json`。

## 进阶

跳过规则、check / tutor 分工、记忆卡片调度、双语卡片细节、自定义 provider，以及上下文模式的成本权衡：

→ **[进阶说明](https://github.com/mackt/pi-language-tutor/blob/main/docs/advanced.zh-CN.md)**

## 开发

```sh
npm install
npm run check   # 类型检查
npm test        # 单元测试
npm run lint
npm run fmt:check
```

目录结构、脚本与产品图生成方式：

→ **[开发说明](https://github.com/mackt/pi-language-tutor/blob/main/docs/development.zh-CN.md)**

欢迎 PR。分支与提交约定见 [AGENTS.md](https://github.com/mackt/pi-language-tutor/blob/main/AGENTS.md)。

## 许可证

[MIT](LICENSE)
