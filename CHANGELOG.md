# Changelog

本项目的所有重要变更都记在这里。版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## 0.2.3 — 对话页里的引用也变紧凑（隐藏位置标签）

- **已发送消息里的引用**：原来显示 `【引用 · 第N轮 · 角色】` + `> 原文` 两行，现在只显示一个**紧凑的原文块**（最多 3 行、超出省略），**位置标签不再显示**
- **点击该引用块即跳回原文并高亮**，没有任何可见的"跳转"按钮
- **消息本体不变**：发送给模型的内容仍以 `【引用 · 第N轮 · 角色】` 开头 → "让模型知道你说的是哪一处"这一核心能力完整保留
- 输入框上方的引用块（0.2.2 引入）维持紧凑样式

## 0.2.2 — 引用界面改为紧凑式

- **输入框上方的引用块**：不再显示 `引用#N · 第N轮 · 角色` 这类标签，改为**只显示原文片段**（单行、超出省略）；点一下即跳回原文并高亮，且**不再弹出"已跳转"提示**、取消常驻导航条 —— 输入区更干净
- 输入框内的 chip 标签简化为 `引用1` / `引用2`（唯一、简短）
- **定位能力不变**：锚点仍写入 `localStorage`（按会话，≤60 条），多轮对话里仍可精确跳回；发送的引用块仍以 `【引用 · 第N轮 · 角色】` 开头（模型侧定位不受影响）
- 引用块不提供删除按钮：要撤掉引用，请在输入框用 Backspace 删除对应 chip

## 0.2.1 — 文档与自动发版

- README / README.en：新增 npm 版本、CI、License 徽章；安装章节补上 `dsh plugin add dsh-quote-annotate-pro`（npm）与 `github:` 两种方式
- 新增 `.github/workflows/release.yml`：推 `v*` 标签即由 **npm Trusted Publishing（OIDC）** 自动发布，仓库不存任何 token，并生成 provenance 签名
- `lib/client.js` 相对 0.2.0 **无变化**（本次发版只为验证 OIDC 发布链路并把文档同步到 npm）

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
