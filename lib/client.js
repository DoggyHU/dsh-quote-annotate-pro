// dsh-quote-annotate-pro —— Client 半区（浏览器）
// Fork of dsh-quote-annotate v0.1.1 (MIT, wangwei-wade) —— 增强：精确锚点 / 可观测性
// 上游 bundle 形态保留：window.__ModuleLoader__ 工厂式 CJS
window.__ModuleLoader__.load({
  id: 'dsh-quote-annotate-pro',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    let React = require('react')

    // ============ 诊断通道（开发期；探测不到本地接收端就本次运行静默） ============
    // 想彻底关闭：把 DIAG_ENABLED 改成 false（或注释掉 sendReport 的 fetch）。
    const DIAG_ENABLED = true
    const DIAG_URL = 'http://127.0.0.1:47821/dsh-quote-pro'
    let diagReady = null // null=探测中 true=可用 false=不可用
    const diagQueue = []
    function sendReport(text) {
      try {
        if (typeof fetch === 'function') {
          Promise.resolve(fetch(DIAG_URL, { method: 'POST', body: text, keepalive: true })).catch(() => {})
        }
      } catch (e) { /* ignore */ }
    }
    function report(tag, detail) {
      try {
        let text
        if (detail === undefined) text = tag
        else if (typeof detail === 'string') text = tag + ' ' + detail
        else {
          try { text = tag + ' ' + JSON.stringify(detail) } catch (e) { text = tag + ' <unserializable>' }
        }
        console.log('[quote-pro]', text)
        if (!DIAG_ENABLED || diagReady === false) return
        if (diagReady === null) {
          diagQueue.push(text)
          if (diagQueue.length > 60) diagQueue.shift()
          return
        }
        sendReport(text)
      } catch (e) { /* diagnostics must never throw */ }
    }
    if (DIAG_ENABLED && typeof fetch === 'function') {
      try {
        fetch(DIAG_URL + '/ping', { method: 'POST', body: 'ping' }).then(() => {
          diagReady = true
          const pending = diagQueue.splice(0)
          for (const text of pending) sendReport(text)
        }).catch(() => { diagReady = false })
      } catch (e) { diagReady = false }
    } else {
      diagReady = false
    }
    report('module:materialized', { id: 'dsh-quote-annotate-pro' })

    // ============ 引用锚点文案：让模型知道"这指的是哪一处" ============
    // role/kind 取自 DOM 的 data-chat-flow-kind，turn 取自 data-chat-turn（与 TurnLocation.turn 同源，0 基）
    function roleText(role, kind) {
      const k = role || kind
      if (k === 'user') return '你的消息'
      if (k === 'assistant-step' || k === 'assistant') return 'DSH 回复'
      if (k === 'tool-call') return '工具调用'
      if (k === 'steering') return '插话'
      if (k === 'turn-tail') return '回合结算'
      if (k === 'question-reply') return '你的答复'
      if (k === 'command' || k === 'command-input') return '命令'
      return k ? '消息(' + k + ')' : ''
    }
    function anchorLabelOf(item) {
      const parts = []
      if (item && typeof item.turn === 'number' && Number.isFinite(item.turn)) parts.push('第' + (item.turn + 1) + '轮')
      const role = roleText(item && item.role, item && item.kind)
      if (role !== '') parts.push(role)
      return parts.join(' · ')
    }
    /** 引用块首行：模型据此确定"哪一轮、谁说的"，多轮对话里不再靠猜。 */
    function buildQuoteHeader(item) {
      const label = anchorLabelOf(item)
      return label === '' ? '' : '【引用 · ' + label + '】'
    }

    // ============ 锚点持久化：刷新后 chip 仍能跳回原文 ============
    // key: dsh-quote-pro:ref:<sessionId> -> { <ref>: { anchorKey, body, label, at } }
    const STORE_PREFIX = 'dsh-quote-pro:ref:'
    function loadRefMap(sessionId) {
      try {
        const raw = localStorage.getItem(STORE_PREFIX + sessionId)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : null
      } catch (e) { return null }
    }
    function saveRef(sessionId, ref, info) {
      try {
        const map = loadRefMap(sessionId) || {}
        map[ref] = { anchorKey: info.anchorKey || null, body: info.body || '', label: info.label || '', at: Date.now() }
        const keys = Object.keys(map)
        if (keys.length > 60) {
          keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0))
          for (const k of keys.slice(0, keys.length - 60)) delete map[k]
        }
        localStorage.setItem(STORE_PREFIX + sessionId, JSON.stringify(map))
      } catch (e) { /* 存储不可用不影响主流程 */ }
    }
    function hydrateRefs(sessionId) {
      const map = loadRefMap(sessionId)
      if (!map) return 0
      let n = 0
      for (const ref of Object.keys(map)) {
        if (refTargets.has(ref)) continue
        const info = map[ref] || {}
        refTargets.set(ref, { sessionId, anchorKey: info.anchorKey || null, body: info.body || '', label: info.label || '', restored: true })
        n += 1
      }
      if (n > 0) report('refs:hydrated', { sessionId: String(sessionId).slice(0, 8), count: n })
      return n
    }
    // 每次页面运行使用独立前缀，避免刷新后新 ref 与历史 ref 撞号
    const REF_RUN = Math.random().toString(36).slice(2, 6)


    // ============ chip 插入：走官方 session 事件（本版本 shell.insertReference 由它驱动） ============
    // 注意：这里必须直接对传入的 Cordis 上下文调用 .emit —— 写成 ctx.ctx 会触发
    // 「cannot get property "ctx" without inject」守卫错误（本插件未声明该 inject）。
    function emitInsertReference(emitCtx, input, before, reference) {
      if (!emitCtx || typeof emitCtx.emit !== 'function') return false
      if (!before || before.draftRev === undefined) return false
      try {
        emitCtx.emit('slash/input-insert-reference', {
          reference,
          span: { draftRev: before.draftRev, start: (before.draft || '').length, end: (before.draft || '').length },
        })
      } catch (e) {
        report('emit:throw', String((e && e.stack) || (e && e.message) || e))
        return false
      }
      const after = input.state.getSnapshot()
      return after.draftRev !== before.draftRev
    }

    // ============ 模块级状态 ============
    let rootCtx = null
    let currentSessionId = null
    let refSeq = 0
    let pipelineAvailable = null // null=未知 false=不可用 true=可用
    // ref -> { sessionId, anchorKey, body, label } 用于点击 chip 跳回原文 / 悬停显示原文
    const refTargets = new Map()
    // ref -> { body, clipboardText } 提交时经 codec 序列化
    const refCodecs = new Map()

    // 页面内反馈 toast（点击 chip 时显示结果）
    const toastStore = {
      text: '',
      pos: null, // { left, top }
      ok: false,
      listeners: new Set(),
      subscribe(fn) {
        this.listeners.add(fn)
        return () => { this.listeners.delete(fn) }
      },
      emit() {
        this.listeners.forEach((fn) => fn())
      },
      show(text, pos, ok) {
        this.text = text
        this.pos = pos
        this.ok = !!ok
        this.emit()
      },
      hide() {
        if (!this.text) return
        this.text = ''
        this.pos = null
        this.emit()
      },
    }

    function useToast() {
      const [, force] = React.useState(0)
      React.useEffect(() => toastStore.subscribe(() => force((v) => v + 1)), [])
      return toastStore
    }

    // ============ 选区浮动小气泡 store ============
    const selectionStore = {
      visible: false,
      text: '',
      rect: null,
      anchorKey: null,
      listeners: new Set(),
      subscribe(fn) {
        this.listeners.add(fn)
        return () => { this.listeners.delete(fn) }
      },
      emit() {
        this.listeners.forEach((fn) => fn())
      },
      show(info) {
        this.visible = true
        this.text = info.text
        this.rect = info.rect
        this.anchorKey = info.anchorKey || null
        // 位置信息必须一起存：否则 stage() 读到的 turn/kind 恒为 null，引用块首行就空了
        this.turn = typeof info.turn === 'number' && Number.isFinite(info.turn) ? info.turn : null
        this.kind = info.kind || null
        this.emit()
      },
      hide() {
        if (!this.visible) return
        this.visible = false
        this.emit()
      },
    }

    function useSelection() {
      const [, force] = React.useState(0)
      React.useEffect(() => selectionStore.subscribe(() => force((v) => v + 1)), [])
      return selectionStore
    }

    // ============ 悬浮批注编辑框 store（单条，锚定在对应文字附近） ============
    const editorStore = {
      item: null, // { sessionId, label, text, anchorKey }
      rect: null,
      listeners: new Set(),
      subscribe(fn) {
        this.listeners.add(fn)
        return () => { this.listeners.delete(fn) }
      },
      emit() {
        this.listeners.forEach((fn) => fn())
      },
      open(item, rect) {
        this.item = item
        this.rect = rect
        this.emit()
      },
      close() {
        if (!this.item) return
        this.item = null
        this.rect = null
        this.emit()
      },
    }

    function useEditor() {
      const [, force] = React.useState(0)
      React.useEffect(() => editorStore.subscribe(() => force((v) => v + 1)), [])
      return editorStore
    }

    // ============ 引用悬停提示 store ============
    const tooltipStore = {
      visible: false,
      text: '',
      label: '',
      rect: null,
      listeners: new Set(),
      subscribe(fn) {
        this.listeners.add(fn)
        return () => { this.listeners.delete(fn) }
      },
      emit() {
        this.listeners.forEach((fn) => fn())
      },
      show(info) {
        this.visible = true
        this.text = info.text
        this.label = info.label
        this.rect = info.rect
        this.emit()
      },
      hide() {
        if (!this.visible) return
        this.visible = false
        this.emit()
      },
    }

    function useTooltip() {
      const [, force] = React.useState(0)
      React.useEffect(() => tooltipStore.subscribe(() => force((v) => v + 1)), [])
      return tooltipStore
    }

    // ============ 样式注入（静态包环境：直接操作 document） ============
    function insertStyleSheet(css) {
      const tag = document.createElement('style')
      tag.textContent = css
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    // ============ 文本工具 ============
    function textBlocksToText(blocks, kindField, typeValue) {
      const parts = []
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b && b[kindField] === typeValue && typeof b.text === 'string' && b.text.trim() !== '') {
            parts.push(b.text.trim())
          }
        }
      }
      return parts.join('\n\n')
    }

    function clipText(text, max) {
      if (text.length <= max) return text
      return text.slice(0, max) + '\n…（已截断）'
    }

    const MAX_QUOTE = 1500
    const MAX_SELECTION = 2000

    // 从 Chat 快照中提取某一轮的用户提问文本与最终 AI 回答文本。
    // 本版本（0.2.0-rc.1）的真实形状：
    //   snapshot.nodes 是 Map（不是数组）、身份字段是 anchorSeq（不是 seq）、
    //   user 文本在 node.data.content[{type:'text'}]、assistant-step 在 node.data.blocks[{kind:'text'}]。
    function extractTurnTexts(chat, turnLoc) {
      const empty = { userText: '', assistantText: '' }
      try {
        if (!chat || !turnLoc || typeof turnLoc.turn !== 'number') return empty
        const turn = turnLoc.turn
        const endSeq = turnLoc.end ? turnLoc.end.seq : Number.POSITIVE_INFINITY
        let prevEnd = 0
        if (chat.turnEnds && typeof chat.turnEnds.forEach === 'function') {
          chat.turnEnds.forEach((seq, t) => {
            if (typeof t === 'number' && typeof seq === 'number' && t < turn && seq > prevEnd) prevEnd = seq
          })
        }
        const nodes = chat.nodes
        if (!nodes) return empty
        const userParts = []
        let assistantText = ''
        let assistantSeq = -1
        const visit = (node) => {
          if (!node || typeof node.anchorSeq !== 'number') return
          if (node.anchorSeq <= prevEnd || node.anchorSeq > endSeq) return
          const data = node.data || {}
          if (node.kind === 'user' || node.kind === 'steering') {
            const text = textBlocksToText(data.content, 'type', 'text')
            if (text !== '') userParts.push(text)
          } else if (node.kind === 'assistant-step') {
            if (typeof data.turn === 'number' && data.turn !== turn) return
            if (node.anchorSeq > assistantSeq) {
              const text = textBlocksToText(data.blocks, 'kind', 'text')
              if (text !== '') {
                assistantSeq = node.anchorSeq
                assistantText = text
              }
            }
          }
        }
        const keys = chat.locations && typeof chat.locations.getTurn === 'function' ? chat.locations.getTurn(turn) : null
        if (Array.isArray(keys) && typeof nodes.get === 'function') {
          for (const key of keys) visit(nodes.get(key))
        } else if (typeof nodes.forEach === 'function') {
          nodes.forEach(visit)
        }
        return { userText: userParts.join('\n\n'), assistantText }
      } catch (e) {
        report('turnTail:extract-throw', String((e && e.message) || e))
        return empty
      }
    }

    // 解析某一轮里指定类型消息行的 DOM 锚点 key（= ChatNode.key，即 data-chat-anchor-key）
    function anchorKeyFor(chat, turn, kind, closingSeq) {
      try {
        if (!chat || !chat.locations || !chat.nodes) return null
        const keys = chat.locations.getTurn(turn) || []
        let fallback = null
        let prefer = null
        for (const key of keys) {
          const node = chat.nodes.get(key)
          if (!node || node.kind !== kind) continue
          fallback = key
          if (kind === 'user') return key
          if (kind === 'assistant-step') {
            const finalSeq = node.data && node.data.finalNode ? node.data.finalNode.seq : undefined
            if (typeof closingSeq === 'number' && finalSeq === closingSeq) prefer = key
          }
        }
        return prefer || fallback
      } catch (e) {
        return null
      }
    }

    // ============ 跳转与提示（模块级：dock 导航条与旧 chip 处理共用） ============
    let notifyTimer = null
    function notify(text, pos, ok) {
      try {
        report('toast', (ok ? 'ok | ' : 'err | ') + text)
        toastStore.show(text, pos, ok)
        if (notifyTimer) clearTimeout(notifyTimer)
        notifyTimer = setTimeout(() => toastStore.hide(), 2600)
      } catch (e) { /* ignore */ }
    }
    /** 跳到某个锚点行并高亮它。opts.silent=true 时不弹成功提示（高亮本身就是反馈）。 */
    function jumpToAnchorKey(anchorKey, pos, opts) {
      if (!anchorKey) return false
      let row = null
      for (const r of document.querySelectorAll('[data-chat-anchor-key]')) {
        if (r.getAttribute('data-chat-anchor-key') === anchorKey) { row = r; break }
      }
      if (!row) {
        notify('跳转失败：原文不在当前页面（可能切了会话或还没加载）', pos, false)
        report('jump:miss', { anchorKey })
        return false
      }
      row.scrollIntoView({ block: 'center', behavior: 'smooth' })
      row.classList.add('dshq-flash')
      setTimeout(() => row.classList.remove('dshq-flash'), 1600)
      if (!(opts && opts.silent)) notify('已跳转到原文 ✓', pos, true)
      report('jump:ok', { anchorKey })
      return true
    }
    /** 按 ref 跳回原文：优先用锚点键，退化到按引用正文反查。 */
    function jumpToRef(ref, pos, opts) {
      const info = refTargets.get(ref)
      if (!info) {
        notify('跳转失败：找不到该引用（可能已发送或已删除）', pos, false)
        return false
      }
      let anchorKey = info.anchorKey || null
      if (!anchorKey && info.body) {
        const probe = String(info.body)
          .split('\n')
          .map((line) => line.replace(/^【引用[^\n]*】\s*/, '').replace(/^> ?/, ''))
          .join('\n')
          .trim()
          .slice(0, 24)
        for (const r of document.querySelectorAll('[data-chat-anchor-key]')) {
          if (probe && r.textContent && r.textContent.indexOf(probe) !== -1) {
            anchorKey = r.getAttribute('data-chat-anchor-key')
            break
          }
        }
      }
      if (!anchorKey) {
        notify('跳转失败：没有定位键（选中时未识别到消息行）', pos, false)
        return false
      }
      return jumpToAnchorKey(anchorKey, pos, opts)
    }

    /**
     * 按 chip 的 title（= 我们插入时写入的 label）反查 ref。
     * 本版本 chip 没有 data-* 属性，但 ReferenceChip 会把 label 渲染成 title，
     * 因此 title 是最可靠的 DOM 侧标识，不必按 CSS 类猜顺序。
     */
    function refByLabel(label) {
      if (typeof label !== 'string' || label === '') return null
      const wanted = label.trim()
      for (const [ref, info] of refTargets) {
        if (info && typeof info.label === 'string' && info.label.trim() === wanted) return ref
      }
      // 退化：只按 `引用#N` 前缀匹配（label 可能被截断显示）
      const short = wanted.split('·')[0].trim()
      if (short.startsWith('引用#')) {
        for (const [ref, info] of refTargets) {
          if (info && typeof info.label === 'string' && info.label.trim().startsWith(short)) return ref
        }
      }
      return null
    }

    // 按 occurrenceId 解析引用（chip 点击跳转 / 悬停提示共用）
    function resolveOccurrence(occId) {
      try {
        const conversation = rootCtx ? rootCtx.get('conversation') : undefined
        const sessions = rootCtx ? rootCtx.get('sessions') : undefined
        if (!conversation || !conversation.input || !sessions) return null
        const trySession = (sessionId) => {
          if (!sessionId) return null
          const binding = sessions.binding(sessionId)
          if (!binding) return null
          const input = conversation.input.for(binding.ctx)
          const occurrences = input.state.getSnapshot().occurrences || []
          const found = occurrences.find((o) => o.occurrenceId === occId) || null
          // 刷新后 ref → 锚点映射从 localStorage 复原（上游此映射仅存内存，刷新即失效）
          if (found && found.source === 'quote-ref' && !refTargets.has(found.ref)) hydrateRefs(sessionId)
          return found
        }
        let occ = trySession(currentSessionId)
        if (!occ) {
          for (const refKey of refTargets.keys()) {
            const info = refTargets.get(refKey)
            if (!info || !info.sessionId) continue
            occ = trySession(info.sessionId)
            if (occ) break
          }
        }
        if (!occ || occ.source !== 'quote-ref') return null
        return { occ, info: refTargets.get(occ.ref) }
      } catch (e) {
        return null
      }
    }

    // ============ 链条目选择器：仅在已结束且无交付文件的回合挂载 ============
    function selectTurnQuote(owner) {
      if (!owner || !owner.turn || !owner.turn.end) return null
      const delivered = owner.turn.data ? owner.turn.data.get('deliverables') : undefined
      if (delivered && Array.isArray(delivered.produced) && delivered.produced.length > 0) return null
      return { turn: owner.turn.turn }
    }

    function rectOf(e) {
      try {
        const r = e.currentTarget.getBoundingClientRect()
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      } catch (err) {
        return null
      }
    }

    // ============ 组件一：回合尾部的引用按钮（点击直接打开悬浮编辑框） ============
    const TurnQuoteActions = (props) => {
      // 本版本该轮文本在 Chat 快照里（useChat），不在 session 快照里；
      // 且 nodes 是 Map、身份字段是 anchorSeq —— 上游按数组 + seq 读，永远取空，所以按钮不出现。
      const chat = typeof props.useChat === 'function' ? props.useChat((s) => s) : undefined
      const texts = React.useMemo(() => extractTurnTexts(chat, props.turn), [chat, props.turn])
      if (props.turn && !turnTailReported.has(props.turn.turn)) {
        turnTailReported.add(props.turn.turn)
        try {
          report('turnTail:render', {
            turn: props.turn.turn,
            hasChat: !!chat,
            nodeCount: chat && chat.nodes && typeof chat.nodes.size === 'number' ? chat.nodes.size : null,
            userChars: texts.userText.length,
            assistantChars: texts.assistantText.length,
            userAnchor: anchorKeyFor(chat, props.turn.turn, 'user', props.seq) || null,
            assistantAnchor: anchorKeyFor(chat, props.turn.turn, 'assistant-step', props.seq) || null,
          })
        } catch (e) { /* ignore */ }
      }
      const open = (e, role, label, text) => {
        noteSession(props.sessionId, 'turnTail')
        const anchorKey = anchorKeyFor(chat, props.turn.turn, role, props.seq)
        editorStore.open({ sessionId: props.sessionId, label, text, anchorKey, turn: props.turn.turn, kind: role === 'user' ? 'user' : 'assistant-step' }, rectOf(e))
      }
      const buttons = []
      if (texts.userText) {
        buttons.push(React.createElement('button', {
          key: 'user',
          type: 'button',
          className: 'dshq-btn',
          onClick: (e) => open(e, 'user', '引用提问 · 第 ' + (props.turn.turn + 1) + ' 轮', clipText(texts.userText, MAX_QUOTE)),
        }, '引用提问'))
      }
      if (texts.assistantText) {
        buttons.push(React.createElement('button', {
          key: 'assistant',
          type: 'button',
          className: 'dshq-btn',
          onClick: (e) => open(e, 'assistant', '引用回答 · 第 ' + (props.turn.turn + 1) + ' 轮', clipText(texts.assistantText, MAX_QUOTE)),
        }, '引用回答'))
      }
      if (buttons.length === 0) return null
      return React.createElement('div', { className: 'dshq-tail' }, buttons)
    }

    // ============ 当前会话解析 ============
    // 重要：本版本（0.1.6+）的会话列表快照没有 current 字段，读 s.current 恒为 undefined。
    // 可靠来源是「会话作用域槽位」回填的 sessionId（root 作用域的 shell.overlay 拿不到它），
    // 其次才是右侧栏 mounted 席位。
    let toolbarPropsReported = false
    let insertProbeDone = false
    const turnTailReported = new Set()
    /**
     * 零副作用插入探针：用过期 draftRev 发一次 insert-reference 事件。
     * shell.insertReference 会先做 CAS（span.draftRev !== rev → return false），
     * 因此不会改动草稿，但能验证"上下文可用 + 监听器会被派发"这条通路。
     */
    function probeInsertPath(sessionId) {
      if (insertProbeDone) return
      insertProbeDone = true
      try {
        const conversation = rootCtx ? rootCtx.get('conversation') : undefined
        const sessions = rootCtx ? rootCtx.get('sessions') : undefined
        const binding = sessions ? sessions.binding(sessionId) : undefined
        if (!conversation || !conversation.input || !binding) {
          report('probe:emit-skip', 'no conversation/binding')
          return
        }
        const input = conversation.input.for(binding.ctx)
        let emitCtx = binding.ctx
        let isScope = false
        try {
          if (typeof sessions.scope === 'function') {
            const scoped = sessions.scope(sessionId)
            if (scoped) { emitCtx = scoped; isScope = true }
          }
        } catch (e) { report('probe:scope-throw', String((e && e.message) || e)) }
        emitCtx.emit('slash/input-insert-reference', {
          reference: { source: 'quote-ref', ref: 'probe-noop', label: 'probe', clipboardText: 'probe' },
          span: { draftRev: -1, start: 0, end: 0 },
        })
        report('probe:emit-ok', { viaScope: isScope, draftRev: input.state.getSnapshot().draftRev })
      } catch (e) {
        report('probe:emit-throw', String((e && e.message) || e))
      }
    }
    function noteSession(id, via) {
      if (typeof id !== 'string' || id === '') return null
      if (currentSessionId !== id) {
        currentSessionId = id
        report('session:resolved', { id: id.slice(0, 8), via })
        setTimeout(() => { try { probeInsertPath(id) } catch (e) { /* ignore */ } }, 0)
      }
      return id
    }
    function resolveSessionId() {
      if (typeof currentSessionId === 'string' && currentSessionId !== '') return currentSessionId
      try {
        const sr = rootCtx ? rootCtx.get('sidebarRight') : undefined
        const snap = sr && sr.mounted && typeof sr.mounted.getSnapshot === 'function' ? sr.mounted.getSnapshot() : undefined
        if (noteSession(snap, 'sidebarRight.mounted')) return currentSessionId
      } catch (e) {
        report('session:sidebarRight-throw', String((e && e.message) || e))
      }
      return currentSessionId || null
    }

    // 会话作用域探针：注册进 conversation.input.dock —— 它在屏即代表该会话正在被查看
    const SessionProbe = (props) => {
      try { noteSession(props && props.sessionId, 'dock-probe') } catch (e) { /* ignore */ }
      return null
    }

    // ============ 组件二：鼠标选区浮动小气泡（点击「批注」打开悬浮编辑框） ============
    const SelectionToolbar = (props) => {
      const sel = useSelection()
      // 本版本会话列表快照没有 current 字段（读取恒为 undefined），
      // 所以这里只把 props 里可能存在的 sessionId 当线索，真正的来源是会话作用域探针。
      if (!toolbarPropsReported) {
        toolbarPropsReported = true
        try {
          report('env:overlay-props', {
            keys: Object.keys(props || {}),
            hasSessionId: typeof (props && props.sessionId) === 'string',
            hasUseSession: typeof (props && props.useSession) === 'function',
            hasUseSessions: typeof (props && props.useSessions) === 'function',
          })
        } catch (e) { /* ignore */ }
      }
      if (typeof props.sessionId === 'string' && props.sessionId !== '') currentSessionId = props.sessionId
      if (!sel.visible || !sel.rect) return null
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
      // 气泡宽度随文字增长：估算 = 每字约13px + 按钮与留白约76px，封顶384px
      const est = Math.min(384, Math.max(120, sel.text.length * 13 + 76))
      const center = sel.rect.left + (sel.rect.right - sel.rect.left) / 2
      const left = Math.max(12, Math.min(center - est / 2, vw - est - 12))
      const top = sel.rect.top - 42 >= 8 ? sel.rect.top - 42 : sel.rect.bottom + 8
      const finish = () => {
        try {
          const s = window.getSelection()
          if (s && s.removeAllRanges) s.removeAllRanges()
        } catch (e) { /* ignore */ }
        selectionStore.hide()
      }
      const stage = () => {
        // 关键修复：不再要求"已解析到会话"才打开编辑框；解析不到也照常进入编辑，
        // 真正的会话在插入时再解析，避免整条链路因为拿不到 sessionId 而静默失效。
        const sid = resolveSessionId()
        const anchorLabel = anchorLabelOf({ turn: sel.turn, kind: sel.kind })
        report('selection:stage', {
          anchorKey: sel.anchorKey || null,
          turn: typeof sel.turn === 'number' ? sel.turn : null,
          kind: sel.kind || null,
          sessionId: sid ? String(sid).slice(0, 8) : null,
        })
        editorStore.open({
          sessionId: sid || null,
          label: anchorLabel === '' ? '选中文字' : '选中 · ' + anchorLabel,
          text: clipText(sel.text, MAX_SELECTION),
          anchorKey: sel.anchorKey,
          turn: sel.turn,
          kind: sel.kind,
        }, sel.rect)
        finish()
      }
      return React.createElement('div', { className: 'dshq-toolbar', style: { left, top } },
        React.createElement('span', { className: 'dshq-toolbar-preview' }, sel.text),
        React.createElement('button', {
          type: 'button',
          className: 'dshq-btn dshq-primary dshq-bubble-cta',
          onMouseDown: (e) => e.preventDefault(),
          onClick: stage,
        }, '批注'),
        React.createElement('button', {
          type: 'button',
          className: 'dshq-btn dshq-close',
          onMouseDown: (e) => e.preventDefault(),
          onClick: finish,
        }, '✕'),
      )
    }

    // ============ 组件三：悬浮批注编辑框（评论输入框元素永久驻留，复用时输入法上下文不重建） ============
    const AnnotationEditor = () => {
      const state = useEditor()
      const inputRef = React.useRef(null)
      const [comment, setComment] = React.useState('')
      const [status, setStatus] = React.useState(null)
      React.useEffect(() => {
        setComment('')
        setStatus(null)
        if (state.item && inputRef.current) {
          // 同一元素重复聚焦：输入法记住的语言模式得以保留
          inputRef.current.focus()
        }
      }, [state.item])
      const open = !!(state.item && state.rect)
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
      const vh = typeof window !== 'undefined' ? window.innerHeight : 768
      const item = state.item
      let left = -9999
      let top = -9999
      let w = 200
      if (open) {
        // 宽度：默认约 10 字（120px），随评论输入变宽，封顶 340px
        const quoteW = Math.min(220, item.text.length * 12 + 16)
        const inputW = Math.min(300, Math.max(140, comment.length * 13 + 44))
        w = Math.max(120, Math.min(340, Math.max(quoteW, inputW)))
        const center = state.rect.left + (state.rect.right - state.rect.left) / 2
        left = Math.max(12, Math.min(center - w / 2, vw - w - 12))
        const estH = 200
        top = state.rect.bottom + 8 + estH <= vh - 8 ? state.rect.bottom + 8 : Math.max(8, state.rect.top - estH - 8)
      }
      const insert = () => {
        if (!open || !item) return
        try {
          const c = (comment || '').trim()
          const header = buildQuoteHeader(item)
          const quoted = item.text.split('\n').map((line) => '> ' + line).join('\n')
          const quoteBody = header === '' ? quoted : header + '\n' + quoted
          const conversation = rootCtx ? rootCtx.get('conversation') : undefined
          const sessions = rootCtx ? rootCtx.get('sessions') : undefined
          if (!conversation || !conversation.input || !sessions) {
            setStatus({ ok: false, text: '写入输入框失败：conversation/sessions 服务不可用' })
            return
          }
          const sessionId = item.sessionId || resolveSessionId()
          if (!sessionId) {
            report('insert:no-session', {})
            setStatus({ ok: false, text: '写入失败：拿不到当前会话，请在对话区里点一下再重试' })
            return
          }
          const binding = sessions.binding(sessionId)
          if (!binding) {
            report('insert:no-binding', { sessionId: String(sessionId).slice(0, 8) })
            setStatus({ ok: false, text: '写入输入框失败：会话不可用' })
            return
          }
          const input = conversation.input.for(binding.ctx)
          const st = input.state.getSnapshot()
          const base = (st.draft || '').replace(/[\s\u00A0]+$/, '')
          const commentTail = c === '' ? '' : '\n\n' + c
          const ref = 'q' + REF_RUN + (++refSeq)
          // 输入框里的 chip 文案只要短、可区分即可（轮次/角色写在发送后的引用块里，不在输入框展示）
          const chipLabel = '引用' + refSeq
          refTargets.set(ref, { sessionId, anchorKey: item.anchorKey || null, body: quoteBody, label: chipLabel })
          refCodecs.set(ref, { body: quoteBody, clipboardText: quoteBody })
          saveRef(sessionId, ref, { anchorKey: item.anchorKey || null, body: quoteBody, label: chipLabel })
          while (refCodecs.size > 200) {
            const oldest = refCodecs.keys().next().value
            refCodecs.delete(oldest)
            refTargets.delete(oldest)
          }
          // 事件派发目标：优先用 sessions.scope()（社区插件在本版本已验证的路径），退回 binding.ctx
          let emitCtx = binding.ctx
          try {
            if (typeof sessions.scope === 'function') {
              const scoped = sessions.scope(sessionId)
              if (scoped) emitCtx = scoped
            }
          } catch (e) { /* 退回 binding.ctx */ }
          // 在草稿末尾插入引用 chip（官方事件；输入机自行追加占位符 + 空格）
          const applied = emitInsertReference(emitCtx, input, st, {
            source: 'quote-ref',
            ref,
            label: chipLabel,
            clipboardText: quoteBody,
          })
          if (applied) {
            // 把评论追加到 chip 之后
            if (commentTail !== '') {
              const st3 = input.state.getSnapshot()
              input.setDraft(st3.draft.replace(/[ \t]+$/, '') + commentTail)
            }
            report('insert:chip', { ref, anchorKey: item.anchorKey || null, header, chars: item.text.length })
            setStatus({
              ok: true,
              text: '已插入引用 ✓' + (item.anchorKey ? '（输入框上方的引用块可点回原文）' : '（未定位到消息行，可能无法跳回）'),
            })
            editorStore.close()
            return
          }
          // 未生效：回退纯文本（内容不丢）
          refTargets.delete(ref)
          refCodecs.delete(ref)
          input.setDraft(base === '' ? quoteBody + commentTail : base + '\n\n' + quoteBody + commentTail)
          report('insert:fallback-plaintext', { ref, header })
          setStatus({ ok: false, text: 'chip 插入未生效，已回退为纯文本引用' })
          editorStore.close()
        } catch (e) {
          setStatus({ ok: false, text: '插入失败：' + (e && e.message ? e.message : String(e)) })
          report('insert:throw', String((e && e.stack) || (e && e.message) || e))
          console.error('[quote-pro] 插入失败', e)
        }
      }
      const hint = pipelineAvailable === false ? '引用锚点管线不可用，将插入纯文本引用' : '插入后输入框下方会出现引用条，点它可跳回原文'
      return React.createElement('div', {
        className: open ? 'dshq-editor' : 'dshq-editor dshq-editor-hidden',
        style: { left, top, width: w },
      },
        React.createElement('div', { className: 'dshq-editor-label' }, open ? item.label : ''),
        React.createElement('div', { className: 'dshq-editor-quote' }, open ? item.text : ''),
        React.createElement('input', {
          ref: inputRef,
          className: 'dshq-editor-input',
          value: comment,
          placeholder: '输入评论…',
          onChange: (e) => setComment(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter') insert()
            if (e.key === 'Escape') editorStore.close()
          },
        }),
        status && open ? React.createElement('div', { className: status.ok ? 'dshq-editor-status dshq-ok' : 'dshq-editor-status dshq-err' }, status.text) : (open ? React.createElement('div', { className: 'dshq-editor-hint' }, hint) : null),
        React.createElement('div', { className: 'dshq-editor-actions' },
          React.createElement('button', { type: 'button', className: 'dshq-btn dshq-primary', onClick: insert }, '插入输入框'),
          React.createElement('button', { type: 'button', className: 'dshq-btn', onClick: () => editorStore.close() }, '✕'),
        ),
      )
    }

    // ============ 组件四：引用悬停提示（显示当时选中的文字） ============
    const QuoteTooltip = () => {
      const t = useTooltip()
      if (!t.visible || !t.rect) return null
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
      const vh = typeof window !== 'undefined' ? window.innerHeight : 768
      const w = Math.min(340, Math.max(180, Math.min(t.text.length, 60) * 11 + 48))
      const estH = Math.min(200, 56 + Math.ceil(Math.min(t.text.length, 400) / 22) * 15)
      const center = t.rect.left + (t.rect.right - t.rect.left) / 2
      const left = Math.max(8, Math.min(center - w / 2, vw - w - 8))
      let top = t.rect.top - estH - 8
      if (top < 8) top = Math.min(vh - estH - 8, t.rect.bottom + 8)
      return React.createElement('div', { className: 'dshq-tip', style: { left, top, width: w } },
        React.createElement('div', { className: 'dshq-tip-label' }, t.label),
        React.createElement('div', { className: 'dshq-tip-quote' }, t.text),
      )
    }

    // ============ 组件五：点击 chip 的反馈 toast（shell.overlay 条目） ============
    const FeedbackToast = () => {
      const t = useToast()
      if (!t.text || !t.pos) return null
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
      const left = Math.max(12, Math.min(t.pos.left - 80, vw - 180))
      return React.createElement('div', {
        className: t.ok ? 'dshq-toast dshq-toast-ok' : 'dshq-toast dshq-toast-err',
        style: { left, top: t.pos.top + 18 },
      }, t.text)
    }

    // ============ 样式（主题令牌自适应明暗） ============
    // ============ 组件六：输入框上方的引用块（紧凑样式；点击可跳回原文，但不显式提示） ============
    // 本版本输入框里的引用 chip 没有 data 属性（只有 CSS 类），DOM 无法反查 occurrence；
    // 因此这里直接读官方输入状态的 occurrences（source === 'quote-ref'）来渲染。
    // 展示的是**原文片段本身**（不再显示「引用#N · 第N轮 · 角色」这类标签），保持输入区干净；
    // 定位能力保留：点一下就跳回原文并高亮，只是不做任何可见的"跳转"提示。
    const SNIPPET_MAX = 90
    const snippetOf = (body) => {
      const raw = String(body || '')
        .split('\n')
        .filter((line) => line.trim() !== '' && !/^【引用/.test(line.trim()))
        .map((line) => line.replace(/^>\s?/, ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      return raw.length > SNIPPET_MAX ? raw.slice(0, SNIPPET_MAX) + '…' : raw
    }

    const QuoteBlock = ({ item }) => {
      const onJump = (e) => {
        try {
          const r = e.currentTarget.getBoundingClientRect()
          report('dock:click', { ref: String(item.ref), anchorKey: item.anchorKey || null })
          jumpToRef(item.ref, { left: r.left + 16, top: r.top }, { silent: true })
        } catch (err) { /* ignore */ }
      }
      return React.createElement('div', {
        className: 'dshq-quote-block',
        onClick: onJump,
        onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') onJump(e) },
        role: 'button',
        tabIndex: 0,
        title: '点击跳回原文',
      }, React.createElement('span', { className: 'dshq-quote-block-text' }, item.snippet || '引用'))
    }

    const QuoteDock = (props) => {
      // 槽位作用域是 session，正常会带 sessionId；拿不到时退回模块级解析结果
      const sessionId = (props && typeof props.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : null) || resolveSessionId() || null
      const [rows, setRows] = React.useState([])
      React.useEffect(() => {
        if (!sessionId) { setRows([]); return undefined }
        let input = null
        try {
          const conversation = rootCtx ? rootCtx.get('conversation') : undefined
          const sessions = rootCtx ? rootCtx.get('sessions') : undefined
          const binding = sessions ? sessions.binding(sessionId) : undefined
          input = conversation && conversation.input && binding ? conversation.input.for(binding.ctx) : null
        } catch (e) {
          report('dock:input-throw', String((e && e.message) || e))
        }
        if (!input || !input.state) return undefined
        const read = () => {
          try {
            const snap = input.state.getSnapshot()
            const occurrences = (snap && snap.occurrences) || []
            const next = []
            for (const occ of occurrences) {
              if (!occ || occ.source !== 'quote-ref') continue
              const info = refTargets.get(occ.ref)
              next.push({
                ref: occ.ref,
                anchorKey: (info && info.anchorKey) || null,
                snippet: snippetOf(info && info.body),
              })
            }
            setRows(next)
            if (next.length > 0) report('dock:rows', { count: next.length })
          } catch (e) { /* ignore */ }
        }
        read()
        let off
        let timer = null
        try {
          if (typeof input.state.subscribe === 'function') off = input.state.subscribe(read)
          else timer = setInterval(read, 800)
        } catch (e) { timer = setInterval(read, 800) }
        return () => {
          try { if (typeof off === 'function') off() } catch (e) { /* ignore */ }
          if (timer !== null) clearInterval(timer)
        }
      }, [sessionId])
      if (!sessionId || rows.length === 0) return null
      const children = []
      for (const row of rows) children.push(React.createElement(QuoteBlock, { key: row.ref, item: row }))
      return React.createElement('div', { className: 'dshq-dock' }, children)
    }

    const css = `
.dshq-tail{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;margin-left:2px}
.dshq-btn{appearance:none;background:transparent;border:1px solid transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1.4;padding:2px 8px;border-radius:6px;cursor:pointer;transition:background .12s ease,color .12s ease}
.dshq-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dshq-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.dshq-primary:hover{background:var(--dsw-alias-brand-primary);color:#fff;opacity:.9}
.dshq-toolbar{position:fixed;display:flex;align-items:center;gap:4px;min-width:10em;width:max-content;max-width:min(32em,calc(100vw - 24px));font-size:12px;padding:3px 7px;border-radius:999px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 4px 14px rgba(0,0,0,.14);pointer-events:auto;box-sizing:border-box}
.dshq-toolbar-preview{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshq-bubble-cta{flex:none;padding:1px 8px;border-radius:999px}
.dshq-close{flex:none;padding:1px 5px;opacity:.7}
.dshq-editor{position:fixed;display:flex;flex-direction:column;gap:5px;box-sizing:border-box;padding:8px 10px;border-radius:10px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 8px 24px rgba(0,0,0,.18);pointer-events:auto;font-size:12px}
.dshq-editor-hidden{opacity:0;pointer-events:none}
.dshq-editor-label{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshq-editor-quote{margin:0;padding:3px 8px;border-left:3px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;max-height:96px;overflow:auto}
.dshq-editor-input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:4px 8px}
.dshq-editor-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dshq-editor-hint{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.8}
.dshq-editor-status{font-size:11px;line-height:1.5}
.dshq-editor-status.dshq-ok{color:var(--dsw-alias-state-success-primary)}
.dshq-editor-status.dshq-err{color:var(--dsw-alias-state-error-primary)}
.dshq-editor-actions{display:flex;justify-content:flex-end;gap:6px}
.dshq-tip{position:fixed;display:flex;flex-direction:column;gap:4px;box-sizing:border-box;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 6px 18px rgba(0,0,0,.18);pointer-events:none;z-index:2147483000;font-size:12px}
.dshq-tip-label{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshq-tip-quote{margin:0;padding:3px 8px;border-left:3px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto;font-size:11px}
.dshq-flash{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:4px;border-radius:8px}
.dshq-toast{position:fixed;max-width:240px;padding:5px 9px;border-radius:8px;font-size:11px;line-height:1.5;box-shadow:0 4px 14px rgba(0,0,0,.18);pointer-events:none;z-index:2147483000}
.dshq-toast-ok{background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-primary)}
.dshq-toast-err{background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
/* 根因：textarea（透明文字、absolute、inset:0）渲染在 backdrop 之后，整层盖住 chip。
   给 chip 提升 z-index 使其浮到 textarea 之上，点击才能落到 chip 上。 */
[data-occurrence]{pointer-events:auto;cursor:pointer;position:relative;z-index:1}
/* 引用块：贴在输入框卡片上沿（点一下跳回原文，不显示任何"跳转"提示） */
.dshq-dock{display:flex;flex-direction:column;gap:4px;padding:0 6px;margin:6px 0 -2px;min-width:0;box-sizing:border-box}
.dshq-quote-block{display:flex;align-items:center;min-width:0;max-width:100%;box-sizing:border-box;padding:6px 10px;border-radius:12px 12px 4px 4px;background:var(--dsw-alias-bg-layer-2);background:color-mix(in oklab,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:pointer;transition:background .12s ease,color .12s ease}
.dshq-quote-block:hover{color:var(--dsw-alias-label-primary)}
.dshq-quote-block-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 已发送消息里的引用：隐藏位置标签，只显示紧凑的原文块（点击可跳回原文，无可见引导） */
.dshq-sent-header{display:none}
.dshq-sent-quote{display:block;margin:3px 0;padding:6px 10px;border-radius:8px;background:rgba(127,127,127,.10);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;cursor:pointer;overflow:hidden;transition:background .12s ease,color .12s ease}
.dshq-sent-quote:hover{color:var(--dsw-alias-label-primary)}
.dshq-sent-quote-text{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;word-break:break-word}
`

    // ============ 插件主体 ============
    function apply(ctx) {
      rootCtx = ctx
      report('apply:start')
      try {
        const names = ['slots', 'inputTriggers', 'conversation', 'sessions', 'sidebarRight', 'uiSession', 'layout', 'uiWorkspace', 'workspaces', 'chat']
        const have = {}
        for (const n of names) {
          try { have[n] = ctx.get(n) !== undefined } catch (e) { have[n] = 'throw' }
        }
        report('env:services', have)
      } catch (e) { /* ignore */ }
      let slots
      try { slots = ctx.get('slots') } catch (e) { report('apply:slots-throw', String((e && e.message) || e)) }
      report('apply:slots', slots === undefined ? 'undefined' : typeof slots)
      if (slots === undefined) return
      try {
        ctx.effect(() => insertStyleSheet(css), 'dsh-quote-annotate-pro: styles')
      } catch (e) {
        report('apply:styles-throw', String((e && e.stack) || (e && e.message) || e))
      }
      // 注册引用 source（提交时把占位符序列化为引用正文；空候选分组不渲染，不污染 @ 菜单）
      let inputTriggers
      try { inputTriggers = ctx.get('inputTriggers') } catch (e) { report('apply:inputTriggers-throw', String((e && e.message) || e)) }
      pipelineAvailable = !!(inputTriggers && typeof inputTriggers.registerSource === 'function')
      report('apply:pipeline', {
        available: pipelineAvailable,
        hasInsertReference: !!(inputTriggers && typeof inputTriggers.insertReference === 'function'),
      })
      if (pipelineAvailable) {
        try {
          ctx.effect(() => inputTriggers.registerSource({
            trigger: '@',
            name: 'quote-ref',
            order: 100,
            candidates: async () => [],
            onPick: () => undefined,
            codec: {
              clipboardText: (ref) => (refCodecs.get(ref) ? refCodecs.get(ref).clipboardText : ''),
              serialize: (ref) => Promise.resolve(refCodecs.get(ref) ? refCodecs.get(ref).body : ''),
            },
          }), 'dsh-quote-annotate-pro: quote-ref source')
          report('register:quote-ref-source', 'ok')
        } catch (e) {
          pipelineAvailable = false
          report('register:quote-ref-source', 'throw ' + String((e && e.stack) || (e && e.message) || e))
        }
      }
      // 全局监听（选区气泡 / chip 点击跳转 / chip 悬停提示；ctx.effect 保证卸载时全部清理）
      try {
        ctx.effect(() => {
        let raf = 0
        let toastTimer = null
        let hideTimer = null
        const onKey = (e) => {
          if (e.key === 'Escape') {
            selectionStore.hide()
            toastStore.hide()
            tooltipStore.hide()
          }
        }
        const showToast = (text, pos, ok) => notify(text, pos, ok)
        const cancelHide = () => {
          if (hideTimer) {
            clearTimeout(hideTimer)
            hideTimer = null
          }
        }
        const scheduleHide = () => {
          if (hideTimer) return
          hideTimer = setTimeout(() => {
            hideTimer = null
            selectionStore.hide()
          }, 150)
        }
        const onScroll = () => {
          schedule()
          tooltipStore.hide()
        }
        // 用 pointerdown 捕获（比 click 更早，且不受 click 阶段任何 stopPropagation 影响）
        const onChipPress = (e) => {
          try {
            tooltipStore.hide()
            const pos = { left: e.clientX, top: e.clientY }
            const el = e.target && e.target.closest ? e.target.closest('[data-occurrence]') : null
            if (el) {
              const occId = Number(el.getAttribute('data-occurrence'))
              if (!Number.isFinite(occId)) return
              const found = resolveOccurrence(occId)
              if (!found) {
                notify('跳转失败：找不到该引用（可能已发送或被删除）', pos, false)
                return
              }
              report('chip:click', { via: 'occurrence', ref: String(found.occ.ref) })
              jumpToRef(found.occ.ref, pos)
              return
            }
            // 本版本输入框 chip 无 data-occurrence，但带 title=<label>：按 title 反查并跳转
            const titled = e.target && e.target.closest ? e.target.closest('[title]') : null
            if (!titled) return
            const title = titled.getAttribute('title')
            const ref = refByLabel(title)
            if (!ref) return
            report('chip:click', { via: 'title', ref: String(ref), title: String(title).slice(0, 40) })
            jumpToRef(ref, pos)
          } catch (err) {
            notify('跳转出错：' + (err && err.message ? err.message : String(err)), { left: e.clientX, top: e.clientY }, false)
            report('chip:click-throw', String((err && err.message) || err))
          }
        }
        // 悬停 chip：显示当时选中的文字
        const onChipOver = (e) => {
          try {
            const el = e.target && e.target.closest ? e.target.closest('[data-occurrence]') : null
            if (!el) {
              tooltipStore.hide()
              return
            }
            const occId = Number(el.getAttribute('data-occurrence'))
            if (!Number.isFinite(occId)) {
              tooltipStore.hide()
              return
            }
            const found = resolveOccurrence(occId)
            if (!found || !found.info || !found.info.body) {
              tooltipStore.hide()
              return
            }
            const r = el.getBoundingClientRect()
            tooltipStore.show({
              text: (found.info.body || '').replace(/^> /gm, '').trim(),
              label: found.info.label || '引用',
              rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
            })
          } catch (err) { /* ignore */ }
        }
        const onChipOut = (e) => {
          try {
            const el = e.target && e.target.closest ? e.target.closest('[data-occurrence]') : null
            if (!el) return
            const next = e.relatedTarget
            if (next && next.closest && next.closest('[data-occurrence]')) return
            tooltipStore.hide()
          } catch (err) { /* ignore */ }
        }
        const compute = () => {
          raf = 0
          try {
            const sel = window.getSelection()
            if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
              // 选区消失：延迟隐藏，避免流式渲染抖动导致气泡闪没
              scheduleHide()
              return
            }
            const text = (sel.toString() || '').trim()
            if (!text) {
              scheduleHide()
              return
            }
            const range = sel.getRangeAt(0)
            const node = range.commonAncestorContainer
            const host = node && node.nodeType === 1 ? node : (node ? node.parentElement : null)
            if (host && host.closest('textarea, input, [contenteditable="true"]')) {
              scheduleHide()
              return
            }
            const rect = range.getBoundingClientRect()
            if (!rect || (rect.width === 0 && rect.height === 0)) {
              scheduleHide()
              return
            }
            // 选区滚出视口（自动滚动场景）才隐藏；仍在视口内则跟随重定位
            const vh = typeof window !== 'undefined' ? window.innerHeight : 768
            if (rect.bottom < -8 || rect.top > vh + 8) {
              scheduleHide()
              return
            }
            cancelHide()
            const anchor = sel.anchorNode && sel.anchorNode.nodeType === 1 ? sel.anchorNode : (sel.anchorNode ? sel.anchorNode.parentElement : null)
            let anchorKey = null
            let turn
            let kind = null
            if (anchor) {
              const row = anchor.closest('[data-chat-anchor-key]')
              if (row) {
                anchorKey = row.getAttribute('data-chat-anchor-key')
                // 位置信息：轮次 + 该行种类（用于给模型标注"这是哪一处"）
                const rawTurn = row.getAttribute('data-chat-turn')
                if (rawTurn !== null && rawTurn !== '' && Number.isFinite(Number(rawTurn))) turn = Number(rawTurn)
                kind = row.getAttribute('data-chat-flow-kind') || null
              }
            }
            report('selection:show', { chars: text.length, anchorKey, turn, kind })
            selectionStore.show({
              text: clipText(text, MAX_SELECTION),
              rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
              anchorKey,
              turn,
              kind,
            })
          } catch (e) {
            scheduleHide()
          }
        }
        const schedule = () => {
          if (!raf) raf = requestAnimationFrame(compute)
        }
        document.addEventListener('selectionchange', schedule)
        // 滚动/缩放不再盲目隐藏：重新计算选区位置，跟随重定位（执行任务自动滚动时气泡不消失）
        document.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onScroll)
        document.addEventListener('keydown', onKey)
        document.addEventListener('pointerdown', onChipPress, true)
        document.addEventListener('pointerover', onChipOver, true)
        document.addEventListener('pointerout', onChipOut, true)
        return () => {
          document.removeEventListener('selectionchange', schedule)
          document.removeEventListener('scroll', onScroll, true)
          window.removeEventListener('resize', onScroll)
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('pointerdown', onChipPress, true)
          document.removeEventListener('pointerover', onChipOver, true)
          document.removeEventListener('pointerout', onChipOut, true)
          if (raf) cancelAnimationFrame(raf)
          if (hideTimer) clearTimeout(hideTimer)
          if (toastTimer) clearTimeout(toastTimer)
        }
        }, 'dsh-quote-annotate-pro: global listeners')
      } catch (e) {
        report('apply:listeners-throw', String((e && e.stack) || (e && e.message) || e))
      }

      // ============ 已发送消息里的引用：把「【引用 · 第N轮 · 角色】+ > 原文」变成紧凑块 ============
      // 目标（用户要求）：对话页面里不再显示"第几轮/谁说的"这类位置标签，只留一个紧凑的原文块；
      // 点击该块可跳回原文并高亮；**消息本体文本不变**，模型仍然拿得到完整的位置信息。
      try {
        ctx.effect(() => {
          let timer = null
          let observer = null
          const HEADER_RE = /【引用\s*·[^\n】]*】/
          const jumpByText = (text, pos) => {
            const probe = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 24)
            if (probe === '') return
            for (const r of document.querySelectorAll('[data-chat-anchor-key]')) {
              const t = String(r.textContent || '').replace(/\s+/g, ' ')
              if (t.indexOf(probe) !== -1) {
                r.scrollIntoView({ block: 'center', behavior: 'smooth' })
                r.classList.add('dshq-flash')
                setTimeout(() => r.classList.remove('dshq-flash'), 1600)
                report('sent:jump', { anchorKey: r.getAttribute('data-chat-anchor-key') })
                return
              }
            }
            notify('跳转失败：原文不在当前页面', pos, false)
          }
          const buildBlock = (quoteText) => {
            const wrap = document.createElement('div')
            wrap.className = 'dshq-sent-quote'
            wrap.setAttribute('role', 'button')
            wrap.setAttribute('title', '点击跳回原文')
            const span = document.createElement('span')
            span.className = 'dshq-sent-quote-text'
            span.textContent = quoteText
            wrap.appendChild(span)
            wrap.addEventListener('click', (ev) => {
              const r = wrap.getBoundingClientRect()
              jumpByText(quoteText, { left: r.left + 16, top: r.top })
              if (ev && ev.stopPropagation) ev.stopPropagation()
            })
            return wrap
          }
          /** 把承载「【引用…】\n> 原文…」的文本节点拆成：隐藏头部 + 紧凑引用块 + 其余文本 */
          const transformTextNode = (node) => {
            const raw = node.nodeValue || ''
            const m = HEADER_RE.exec(raw)
            if (!m) return false
            const quoteStart = m.index + m[0].length
            const nl = raw.indexOf('\n', quoteStart)
            if (nl < 0) return false
            const lines = raw.slice(nl + 1).split('\n')
            const quote = []
            let i = 0
            while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++ }
            if (quote.length === 0) return false
            const rest = lines.slice(i).join('\n')
            const frag = document.createDocumentFragment()
            const before = raw.slice(0, m.index)
            if (before !== '') frag.appendChild(document.createTextNode(before))
            const hidden = document.createElement('span')
            hidden.className = 'dshq-sent-header'
            hidden.textContent = m[0]          // 位置信息仍留在 DOM（只是不显示）
            frag.appendChild(hidden)
            frag.appendChild(buildBlock(quote.join(' ')))
            if (rest.trim() !== '') frag.appendChild(document.createTextNode(rest))
            node.parentNode.replaceChild(frag, node)
            report('sent:decorated', { chars: quote.join(' ').length })
            return true
          }
          const scan = () => {
            timer = null
            try {
              for (const row of document.querySelectorAll('[data-chat-anchor-key]')) {
                if (row.getAttribute('data-chat-flow-kind') !== 'user') continue
                if (row.dataset && row.dataset.dshqSent === '1') continue
                let walker
                try { walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, null) } catch (e) { continue }
                const targets = []
                let n = walker.nextNode()
                while (n) {
                  if (HEADER_RE.test(n.nodeValue || '')) targets.push(n)
                  n = walker.nextNode()
                }
                let done = false
                for (const t of targets) { try { if (transformTextNode(t)) done = true } catch (e) { /* ignore */ } }
                if (done && row.dataset) row.dataset.dshqSent = '1'
              }
            } catch (e) { report('sent:scan-throw', String((e && e.message) || e)) }
          }
          const schedule = () => { if (timer === null) timer = setTimeout(scan, 300) }
          scan()
          try {
            observer = new MutationObserver(schedule)
            observer.observe(document.body, { childList: true, subtree: true })
          } catch (e) { report('sent:observer-throw', String((e && e.message) || e)) }
          return () => {
            if (timer !== null) clearTimeout(timer)
            if (observer) { try { observer.disconnect() } catch (e) { /* ignore */ } }
          }
        }, 'dsh-quote-annotate-pro: sent quote decoration')
      } catch (e) {
        report('apply:sent-decor-throw', String((e && e.message) || e))
      }
      const tryRegister = (tag, fn) => {
        try { fn(); report('register:ok', tag); return true } catch (e) {
          report('register:throw', tag + ' :: ' + String((e && e.stack) || (e && e.message) || e))
          return false
        }
      }
      // 注意：conversation.chat.turnTail 自 0.1.6-alpha.2 起是 list 槽（不是 chain），
      // 注册参数必须是 { name, id, order }；上游用的 { select, priority } 在本版本会抛错，
      // 且它排在 4 个 overlay 注册之前 —— 一旦抛错就导致整个插件"静默失效"。
      tryRegister('dock:session-probe', () => slots.inject('conversation.input.dock', () => slots.register(
        { name: 'conversation.input.dock', id: 'quote-pro-session-probe', order: 1 },
        SessionProbe,
      )))
      // 引用块回到「输入框卡片上沿」的 dock 槽位（官方说明：Full-width entries above the composer card），
      // 用样式把它做成"贴在输入框上沿"的样子 —— DSH 没有"卡片内部、文字上方"的静态槽位：
      //   conversation.input.overlay 是浮动弹层（放的是 slash-menu / command-popup 这类），
      //   conversation.input.attachments 是官方草稿附件栏（single，占用会顶掉官方附件 UI，不能碰）。
      tryRegister('dock:quote-nav', () => slots.inject('conversation.input.dock', () => slots.register(
        { name: 'conversation.input.dock', id: 'quote-pro-quote-block', order: 2 },
        QuoteDock,
      )))
      tryRegister('turnTail', () => slots.inject('conversation.chat.turnTail', () => slots.register(
        { name: 'conversation.chat.turnTail', id: 'quote-turn-actions', order: 10 },
        TurnQuoteActions,
      )))
      tryRegister('overlay:toolbar', () => slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'quote-pro-selection-toolbar', order: 100 },
        SelectionToolbar,
      )))
      tryRegister('overlay:editor', () => slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'quote-pro-annotation-editor', order: 101 },
        AnnotationEditor,
      )))
      tryRegister('overlay:tooltip', () => slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'quote-pro-tooltip', order: 103 },
        QuoteTooltip,
      )))
      tryRegister('overlay:toast', () => slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'quote-pro-feedback-toast', order: 102 },
        FeedbackToast,
      )))
      report('apply:done', { pipelineAvailable })
    }

    // Cordis 客户端插件：声明依赖让 apply 在 slots 服务就绪后才执行
    // （上游缺少这一行，slots 未就绪时 apply 第 534 行静默 return → 全插件失效）
    exports.name = 'dsh-quote-annotate-pro'
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
