# Changelog

本项目的所有重要变更都记在这里。版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## 0.2.0 — 首个公开发布

Fork 自 [`dsh-quote-annotate`](https://github.com/wangwei-wade/dsh-quote-annotate) v0.1.1（MIT），
在 **DSH 0.2.0-rc.2** 上真机验证。

### 修复（上游在本版本上已无法工作）

1. **缺 cordis 依赖声明导致静默失效**：`apply()` 中 `ctx.get('slots')` 未就绪即 `return`，插件加载成功却一个 UI 都不注册。
   补齐 `exports.name` / `exports.inject = ['slots']`，并给每一步注册加 `try/catch` 与上报。
2. **`conversation.chat.turnTail` 由 chain 变 list**：上游仍按 `{ select, priority }` 注册会抛错，
   且该注册排在 4 个 overlay 注册之前，一崩全崩。改为 `{ name, id, order }`。
3. **引用 chip 插入 API 变更**：`input.insertReference(...)` 在本版本不存在，引用永远退化为纯文本。
   改用官方会话事件 `slash/input-insert-reference`。
4. **当前会话解析失效**：`useSessions(s => s.current)` 恒为 `undefined`（本版本会话列表快照无 `current` 字段），
   点「批注」只会关闭气泡。改用会话作用域槽位探针（`conversation.input.dock`）回填 `sessionId`。
5. **回合尾部按钮不出现**：取文依赖 session 快照 + 数组 + 节点 `seq`；本版本为 Chat 快照（`useChat`）、
   `nodes` 是 Map、身份字段 `anchorSeq`、assistant kind 为 `assistant-step`、文本在 `data.content` / `data.blocks`。
6. **chip 无 DOM 标识**：本版本 chip 已无 `data-occurrence` 属性，上游"点 chip 跳回原文"不可能成立。

### 新增

- **引用块带位置**：序列化首行为 `【引用 · 第N轮 · 角色】`，多轮对话中模型可精确定位引用来源。
- **引用导航条**：注册进 `conversation.input.dock`，读官方输入状态 `occurrences`，点击跳回原文并高亮，悬停预览原文。
- **锚点持久化**：`ref → 锚点` 写入 `localStorage`（按会话，60 条上限），刷新页面后引用仍可跳回。
- **输入框 chip 本体可点**：按 chip 的 `title`（= 插入时的 label）反查 ref，不依赖 CSS 类顺序。
- **诊断通道与自检工具**：`tools/diag-sink.mjs`（本地事件接收端）、`tools/check-manifest.mjs`（清单自检，已接入 CI）。
  插件的诊断上报在探测不到接收端时自动静默。

### 已知限制

- chip 本体跳转按 `title` 反查，label 相同的多条引用只命中最早一条（导航条始终精确）。
- 目标消息行未加载时只给提示，不自动翻页。
- 回合尾部按钮在有交付文件的回合也会显示（上游会隐藏、让位给官方「已生成文件」chips）。
