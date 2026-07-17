# pi-language-tutor

[English](README.md) | 简体中文

一边 coding 一边学外语。这是一个 [pi](https://pi.dev) 扩展：它会检查你 prompt 里的拼写和语法，用母语给你讲解错在哪，还能把 agent 的回复渲染成沉浸式翻译那样的双语对照。

<img src="docs/writing-check.png" width="720" alt="Writing check 面板：agent 照常处理 prompt 的同时，每个错误都给出改法、中文解释，以及整句更地道的说法。">

## 安装

```sh
pi install npm:pi-language-tutor
```

默认配置开箱即用：学英语、母语简体中文。母语是其他语言的话，一条命令切换：`/lang native ja`。

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

1. 启动 `pi`，用你正在学的语言发条 prompt，写错了也没关系：

   ```text
   when agent anwser me, I want translate it, it have three feature
   ```

   agent 照常回答；与此同时编辑器上方会出现 `✏ Writing check` 面板，列出每处错误的改法和中文讲解，最后还有一句整体更地道的表达。

2. agent 回答完，按 `alt+t`（macOS 上是 ⌥T，需要在终端里[把 Option 设为 Meta 键](https://iterm2.com/documentation-preferences-profiles-keys.html)；也可以直接运行 `/translate`）。回复会重新渲染成双语卡片，每个原文段落下面紧跟译文。

   <img src="docs/bilingual-card.png" width="720" alt="双语卡片：agent 回复的每个段落下面紧跟译文，沉浸式翻译风格，代码块原样保留。">

3. 觉得双语对照好用，可以让每条回复自动翻译：

   ```text
   /lang auto on
   ```

   到这里就够用了。

## 工作机制

- **绝不阻塞。** 消息照常立刻发给 agent，写作检查在后台并行跑，面板稍后才出现；没写错就什么都不显示。
- **绝不污染对话。** 翻译卡片只显示在你的终端里，不会发回给 LLM，也不占上下文。
- **花费你说了算。** 两个功能默认用当前会话的模型；用 `/lang model` 换个便宜模型，每次检查的成本就小到可以忽略。

## 命令

| 命令                        | 作用                                               |
| --------------------------- | -------------------------------------------------- |
| `alt+t` 或 `/translate`     | 翻译 agent 回复（双语卡片）                        |
| `/lang`                     | 查看当前配置                                       |
| `/lang on` \| `off`         | 恢复/暂停写作检查                                  |
| `/lang auto on` \| `off`    | 自动翻译每轮最终回复                               |
| `/lang native <code>`       | 设置母语，即译文和讲解使用的语言（`zh-CN`、`ja`…） |
| `/lang learning <code>`     | 设置正在学习的语言（`en`、`fr`…）                  |
| `/lang model <provider/id>` | 用更便宜的模型跑检查和翻译                         |
| `/lang model default`       | 换回会话模型                                       |

## 配置

配置保存在 `~/.pi/agent/language-learn.json`。所有选项都可以用 `/lang` 命令修改，基本不用手动编辑这个文件。

```json
{
  "learning": "en",
  "native": "zh-CN",
  "model": "openai/gpt-4o-mini",
  "enabled": true,
  "auto": false
}
```

`model` 可以不填，默认用当前会话的模型。

## 更多细节

**哪些消息会被检查。** 为了省 token、少打扰，以下消息不会触发写作检查：斜杠/感叹号命令、少于 4 个词的短消息、以代码或路径为主的消息、没用学习语言写的消息，以及 `/lang off` 期间的所有输入。检查只在交互式 TUI 里运行；就算检查失败，也不会影响你的会话。

**双语卡片。** 段落按「原文在上、译文在下」排列，和沉浸式翻译一个风格。短代码块（≤5 行）原样保留，更长的用 `[code block ↑ N lines]` 占位——完整代码就在上方的原文里。自动模式下，中间的工具调用叙述和少于 15 个词的回复不会翻译；开启时底部状态栏会显示 `🌐 auto`。

## 开发

```sh
npm install
npm run check   # 类型检查
npm test        # 单元测试：跳过判定和回复解析
```

目录结构：`src/core.ts` 放纯逻辑（跳过判定、prompt、解析、卡片拼装，测试只依赖这个文件），`src/config.ts` 负责配置读写，`src/index.ts` 是 pi 适配层（唯一 import pi 包的文件），`language-learn.ts` 是入口，重新导出以上模块。
