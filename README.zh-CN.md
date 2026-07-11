# pi-language-tutor

[English](README.md) | 简体中文

一个 [pi](https://pi.dev) 扩展，让你在写代码的同时顺带练外语。

- **写作反馈** — 你用学习语言（比如英语）输入的 prompt 会在后台接受检查（完全不阻塞 agent），覆盖拼写、语法和地道表达三个层面。纠错结果显示在编辑器上方的小面板里，附有母语写的简短解释；当你的句子虽然正确但不够地道时，还会给出一句更自然的说法。消息没有问题时面板自动消失。
- **双语对照翻译** — 按 `alt+t`（或运行 `/translate`）把 agent 的最新回复渲染成沉浸式翻译风格的双语卡片：每个原文段落下面紧跟它的译文（引用块样式）。短代码块（≤5 行）保留在卡片里，长代码块显示为 `[code block ↑ N lines]` 占位符——原文就在正上方，无需重复。卡片不会进入 LLM 上下文，不额外消耗 token。
- **自动模式** — `/lang auto on` 后每轮对话的最终回复都会自动翻译（跳过中间的工具调用过程叙述，以及少于 15 个词的短回复）。开启时底部状态栏显示 `🌐 auto`，翻译进行中显示 `translating…`。
- **默认省钱** — 两个功能默认使用当前会话的模型；用 `/lang model` 可以指定一个更便宜的模型专门跑检查和翻译。

## 安装

把扩展软链接到 pi 的全局扩展目录（自动发现，改动后 `/reload` 即可热重载）：

```sh
ln -s "$(pwd)/language-learn.ts" ~/.pi/agent/extensions/language-learn.ts
```

或者写进 `~/.pi/agent/settings.json`：

```json
{ "extensions": ["/path/to/pi-learn-foreign-language/language-learn.ts"] }
```

无需构建 — pi 直接加载 TypeScript。

## 配置

配置保存在 `~/.pi/agent/language-learn.json`，通过 `/lang` 命令管理：

```
/lang                      查看当前配置
/lang on | off             暂停/恢复写作检查
/lang auto on | off        自动翻译每轮回复（双语卡片）
/lang native ja            设置你的母语（译文目标语言 + 解释用语）
/lang learning fr          设置你正在学习的语言
/lang model openai/gpt-4o-mini   用更便宜的模型跑检查/翻译
/lang model default        使用会话模型
```

默认值：`learning=en`、`native=zh-CN`、会话模型、`auto=off`。

## 哪些消息会被检查

为了避免浪费 token 和产生噪音，写作检查会跳过：斜杠/感叹号命令、少于 4 个词的消息、以代码或路径为主的消息、不是用学习语言写的消息，以及 `/lang off` 期间的一切输入。检查只在交互式 TUI 模式下运行，检查失败绝不会干扰你的会话。

## 开发

```sh
npm install
npm run check   # 类型检查
npm test        # 跳过规则和响应解析的单元测试
```
