# dsh-quote-annotate-pro

**在 DSH 会话里划词 → 批注 → 引用**：选中的文字变成带锚点的引用进入输入框，发送时序列化为结构化引用块；输入框下方常驻一条**引用导航条**，点一下就能跳回原文并高亮。多轮对话里，模型看到的是 `【引用 · 第N轮 · 你的消息】`，不再需要猜"你说的是哪一处"。

> 这是 [`dsh-quote-annotate`](https://github.com/wangwei-wade/dsh-quote-annotate)（MIT，作者 wangwei-wade）的增强 fork。
> 上游 v0.1.1 在 **DSH 0.2.0-rc.2** 上会**静默失效**（既不报错也不注册任何 UI），本 fork 修掉了 4 个兼容性问题，
> 并补上了 3 项能力；另有 2 个接口变化（当前会话、chip DOM 定位）一并适配。许可仍为 MIT，见 [LICENSE](./LICENSE)。
> 完整汇总见 [SUMMARY.md](./SUMMARY.md)。

## 功能

| 能力 | 说明 |
|---|---|
| 划词批注 | 会话里选中任意文字 → 选区上方浮出气泡（预览 + 「批注」）→ 编辑框里写评语（可留空）→ `Enter` 插入 |
| 引用 chip | 输入框里出现 `引用#1 · 第5轮 · DSH 回复` 的原子 chip；发送时展开为完整引用块 |
| **引用导航条** | 输入框下方常驻 `引用 ❝ 引用#1 …`，**点击跳回原文并高亮**，悬停预览原文 |
| **模型侧精确定位** | 引用块首行是 `【引用 · 第5轮 · 你的消息】`，后接 `> 原文`，让模型明确知道**哪一轮、谁说的** |
| 回合级引用 | 每条已完成回合尾部有「引用提问 / 引用回答」，整段引用该轮 |
| 锚点持久化 | `ref → 锚点` 映射写入 `localStorage`（按会话，最多 60 条），**刷新页面后引用条仍能跳回原文** |
| 中英自适应 | 按钮文案跟随界面语言（沿用上游） |

## 与上游的差异

### 兼容性修复（否则整插件静默失效）

1. **缺 cordis 依赖声明** —— 上游 `apply(ctx)` 里 `const slots = ctx.get('slots')`，拿不到就 `return`。
   没有声明 `inject: ['slots']` 时 `apply` 可能早于 slots 服务就绪执行，于是**无声退出，一个 UI 都不注册**。
   → 本 fork 声明 `exports.name` + `exports.inject = ['slots']`，并给每一步注册加 `try/catch` + 上报。

2. **`conversation.chat.turnTail` 已从 chain 变 list**（DSH 0.1.6-alpha.2 起）—— 上游仍用 `{ select, priority }` 注册，
   会抛错；而它排在 4 个 overlay 注册**之前**，一崩全崩。→ 改为 `{ name, id, order }`。

3. **chip 插入 API 变了** —— 上游调用 `input.insertReference(...)`，该对象在本版本没有此方法，永远退化为纯文本。
   → 改走官方会话事件 `slash/input-insert-reference`（与 `dsh-better-sidebar` 同一条在本版本已验证的通路）。

4. **回合尾部按钮不出现（快照形状变了）** —— 上游用 `useSession` 的快照 + `Array.isArray(snapshot.nodes)` + 节点 `seq`
   来取该轮文本；本版本真实形状是 **Chat 快照（`useChat`）**、**`nodes` 是 Map**、**节点身份是 `anchorSeq`**、
   文本在 `user.data.content[{type:'text'}]` / `assistant-step.data.blocks[{kind:'text'}]`，
   assistant 节点 kind 也不是 `assistant` 而是 `assistant-step`。→ 全部按本版本形状重写取文与锚点解析。

### 能力增强

5. **当前会话解析** —— 上游读 `useSessions(s => s.current)`，而**本版本会话列表快照没有 `current` 字段**（恒为 `undefined`），
   导致点「批注」只关掉气泡、什么都不发生。→ 改为由**会话作用域槽位**（`conversation.input.dock` 探针）回填 `sessionId`，
   并去掉"必须先解析到会话才开编辑框"的门槛（解析失败也照常进入编辑，插入时再解析）。

6. **引用块带轮次/角色** —— 上游只发 `> 原文`。→ 首行加 `【引用 · 第N轮 · 角色】`（轮次取自 `data-chat-turn`，角色取自 `data-chat-flow-kind`）。

7. **引用导航条 + 锚点持久化** —— 本版本输入框 chip **没有 `data-*` 属性**（只有 CSS 类），上游"点 chip 跳转"不可能成立。
   → 改为读官方输入状态 `occurrences`（`source === 'quote-ref'`）渲染导航条；`ref → 锚点` 落 `localStorage`，刷新后仍可跳。
   （输入框 chip 本体也支持点击跳转：按 `title` = label 反查 ref，不依赖 CSS 类顺序。）

## 安装

```sh
# 本地开发：
#   <本仓库绝对路径> 为克隆后的目录；link 安装后改文件即刻热更，无需重启
dsh plugin --profile <profile> add <本仓库绝对路径>
```

装好后 profile 的 `package.json` 会出现：

```
"dsh-quote-annotate-pro": "link:<本仓库绝对路径>"
```

## 工作原理

```
选中文字
  │ 气泡「批注」→ 编辑框 → Enter
  ▼
emit('slash/input-insert-reference', { reference, span })      ← 官方会话事件，会话作用域
  │ 输入机 mint 一条 occurrence（source='quote-ref' / ref / label）
  ▼
输入框 chip（官方 Lexical 装饰节点）
  │ 发送
  ▼
本插件 codec.serialize(ref) → 完整引用块
     【引用 · 第5轮 · DSH 回复】
     > 原文……
     （你的评语）
  ▼
模型收到"哪一轮 + 谁说的 + 原文"

跳回原文：导航条/锚点 → [data-chat-anchor-key] 行 → scrollIntoView + 高亮
```

用到的官方接口：`slots`（`shell.overlay` / `conversation.chat.turnTail` / `conversation.input.dock`）、
`conversation.input`（草稿 + occurrences）、`sessions.binding/scope`、`inputTriggers.registerSource` + codec、
DOM 锚点 `data-chat-anchor-key` / `data-chat-turn`。

## 开发

```
lib/client.js          全部功能（手写 bundle，无构建步骤 —— 改完保存即生效）
tools/diag-sink.mjs    本地诊断接收端（可选）
tools/check-manifest.mjs  清单一致性自检（CI 同款）
```

```sh
npm run check    # 校验 package.json / patch / bundle 注册 id 是否一致
npm run diag     # 起诊断接收端（默认 http://127.0.0.1:47821）
```

改完 `lib/client.js` **无需重启 DSH**：宿主按磁盘内容提供 bundle，客户端 HMR 检测到内容变化会自动热更该插件。

### 诊断通道（开发期）

`lib/client.js` 顶部有：

```js
const DIAG_ENABLED = true
const DIAG_URL = 'http://127.0.0.1:47821/dsh-quote-pro'
```

插件启动时 POST 一次 `/ping`；**探测不到接收端就本次运行静默**（不会产生网络噪音）。
配合 `npm run diag`，终端会实时打出全链路事件：

```
module:materialized / apply:start / register:ok …   插件加载与槽位注册
selection:show / selection:stage                    划词与「批注」
insert:chip / insert:fallback-plaintext             引用插入（chip 或纯文本回退）
dock:rows / dock:click / jump:ok / toast            导航条与跳回原文
turnTail:render                                     回合尾部按钮取文
```

不需要时把 `DIAG_ENABLED` 改成 `false` 即可（`console.log('[quote-pro]', …)` 会保留）。

## 已知限制

- **输入框 chip 本体跳转依赖 `title`**：本版本 chip 无 `data-*` 属性，是按渲染出的 `title`（= 插入时写入的 label）反查 ref；
  label 相同的多条引用只会命中最早的一条（导航条则始终精确）。
- **跳转要求原文行在当前页面**：目标消息未加载（历史未翻到）时只能给出提示，不做自动翻页加载。
- **导航条在会话切换后重建**：锚点按会话存储；切到别的会话不会串。
- **回合尾部按钮在有交付文件的回合也会显示**：上游会隐藏、让位给官方「已生成文件」chips。
- **评语以纯文本追加在 chip 之后**：编辑 chip 文本请用 Backspace 删除。

## 贡献

欢迎 Issue / PR。提 PR 前请跑一遍 `npm run check`，并说明验证时使用的 DSH 版本（本仓库在 **0.2.0-rc.2** 上真机验证）。
由于 DSH 仍处于 rc 阶段，内部契约可能随版本变化，改动请附上验证方式。

## 许可与来源

MIT，见 [LICENSE](./LICENSE)。

- 上游：[`wangwei-wade/dsh-quote-annotate`](https://github.com/wangwei-wade/dsh-quote-annotate) v0.1.1（MIT，© 2026 wangwei-wade）
- 本 fork：修复其在 **DSH 0.2.0-rc.2** 上的 6 个兼容性问题，并补充引用定位相关能力，同样以 MIT 发布
