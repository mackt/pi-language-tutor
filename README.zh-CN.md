# pi-language-tutor

[English](README.md) | 简体中文

一边写代码一边学外语。这个 [pi](https://pi.dev) 扩展会检查你 prompt 里的拼写、语法和地道表达——用你的母语解释错在哪——并把 agent 的回复渲染成沉浸式翻译风格的双语对照。

<img src="docs/writing-check.png" width="720" alt="Writing check 面板：agent 照常处理 prompt 的同时，每个错误都给出改法、中文解释，以及整句更地道的说法。">

*带着错误发 prompt，agent 照常干活——`✏ Writing check` 面板用母语解释每处修改。*

## 安装

```sh
pi install npm:pi-language-tutor
```

这是唯一必需的步骤。默认配置（学英语、母语简体中文）开箱即用。母语不是中文？一条命令：`/lang native ja`。

<details>
<summary>备选：从 git 安装，或本地开发</summary>

不经 npm，直接从 GitHub 安装：

```sh
pi install git:github.com/mackt/pi-language-tutor
```

或者克隆仓库，软链接到 pi 的全局扩展目录（通过 package.json 的 `pi.extensions` 字段自动发现，改动后 `/reload` 热重载）——适合开发，因为无需构建，pi 直接加载 TypeScript：

```sh
git clone https://github.com/mackt/pi-language-tutor.git
ln -s "$(pwd)/pi-language-tutor" ~/.pi/agent/extensions/pi-language-tutor
```

</details>

## 先试试这个

1. 启动 `pi`，用你正在学的语言发一句 prompt，带着错误也没关系：

   ```text
   when agent anwser me, I want translate it, it have three feature
   ```

   agent 回答的同时，编辑器上方会出现 `✏ Writing check` 面板：每个错误的改法和中文解释，外加一句整体更地道的说法。

2. agent 回答完，按 `alt+t`（macOS 是 ⌥T——需要在终端里[把 Option 设为 Meta 键](https://iterm2.com/documentation-preferences-profiles-keys.html)，或者直接运行 `/translate`）。回复会重新渲染成双语卡片：每个原文段落下面紧跟译文。

   <img src="docs/bilingual-card.png" width="720" alt="双语卡片：agent 回复的每个段落下面紧跟译文，沉浸式翻译风格，代码块原样保留。">


3. 喜欢双语视图？让它自动化：

   ```text
   /lang auto on
   ```

   到这里就够用了。

## 它是怎么工作的

- **绝不阻塞。** 你的消息立即发给 agent；写作检查并行运行，面板稍后出现。消息没问题时什么也不显示。
- **绝不污染对话。** 翻译卡片只存在于你的终端——永远不会发回给 LLM，不占上下文。
- **花费你说了算。** 两个功能默认用会话模型；`/lang model` 指到一个便宜模型上，一行配置就能让每次检查几乎免费。

## 命令

| 命令 | 作用 |
|------|------|
| `alt+t` 或 `/translate` | 翻译最新的 agent 回复（双语卡片） |
| `/lang` | 查看当前配置 |
| `/lang on` \| `off` | 恢复/暂停写作检查 |
| `/lang auto on` \| `off` | 自动翻译每轮最终回复 |
| `/lang native <code>` | 设置母语——译文目标语言和解释用语（`zh-CN`、`ja`…） |
| `/lang learning <code>` | 设置正在学习的语言（`en`、`fr`…） |
| `/lang model <provider/id>` | 用更便宜的模型跑检查和翻译 |
| `/lang model default` | 换回会话模型 |

## 配置

配置持久化在 `~/.pi/agent/language-learn.json`；`/lang` 命令能管理所有选项，基本不需要手动编辑。

```json
{
	"learning": "en",
	"native": "zh-CN",
	"model": "openai/gpt-4o-mini",
	"enabled": true,
	"auto": false
}
```

`model` 是可选的——不设置时使用会话模型。

## 细节

**哪些消息会被检查。** 为了避免浪费 token 和产生噪音，写作检查会跳过：斜杠/感叹号命令、少于 4 个词的消息、以代码或路径为主的消息、不是用学习语言写的消息，以及 `/lang off` 期间的一切输入。检查只在交互式 TUI 模式下运行，检查失败绝不会干扰你的会话。

**双语卡片。** 段落按"原文在上、译文在下"对齐，沉浸式翻译风格。短代码块（≤5 行）保留在卡片里，长代码块显示为 `[code block ↑ N lines]` 占位符——原文就在正上方。自动模式会跳过中间的工具调用叙述和少于 15 个词的回复；开启时底部状态栏显示 `🌐 auto`。

## 开发

```sh
npm install
npm run check   # 类型检查
npm test        # 跳过规则和响应解析的单元测试
```

目录结构：`src/core.ts` 是纯逻辑（启发式规则、prompt、解析、卡片拼装——测试只导入这个），`src/config.ts` 负责配置持久化，`src/index.ts` 是 pi 适配层（唯一 import pi 包的文件）。`language-learn.ts` 是入口，把两者重新导出。
