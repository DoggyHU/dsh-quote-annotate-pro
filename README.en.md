# dsh-quote-annotate-pro

[![npm version](https://img.shields.io/npm/v/dsh-quote-annotate-pro?color=2ea44f&label=npm)](https://www.npmjs.com/package/dsh-quote-annotate-pro)
[![ci](https://github.com/zhao-guang-ai/dsh-quote-annotate-pro/actions/workflows/ci.yml/badge.svg)](https://github.com/zhao-guang-ai/dsh-quote-annotate-pro/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**Select → annotate → quote, inside a DSH conversation.** The selected text enters the composer as an anchored quote reference; on send it serializes into a structured quote block, and a quote bar under the composer jumps back to the exact source message and highlights it. The model sees `【引用 · 第N轮 · DSH 回复】` — which turn, whose message — so it no longer has to guess what "that part above" means.

> An enhanced fork of [`dsh-quote-annotate`](https://github.com/wangwei-wade/dsh-quote-annotate) (MIT, by wangwei-wade).
> Upstream v0.1.1 **fails silently** on **DSH 0.2.0-rc.2** (loads without error, registers no UI at all). This fork fixes 4 compatibility
> problems, adapts 2 further interface changes, and adds 3 capabilities. Still MIT — see [LICENSE](./LICENSE).
> Full write-up: [SUMMARY.md](./SUMMARY.md) (Chinese).

## Features

| Capability | Detail |
| --- | --- |
| Select & annotate | Select text in the transcript → a bubble appears above the selection → write a comment (optional) → `Enter` |
| Quote chip | An atomic `引用1` chip (short label) lands in the composer; it expands to the full quote block on send |
| **Quote block** | While a quote is in the composer, a compact block above it shows the **quoted text snippet** (single line, ellipsised). Click it to jump back to the source and highlight it — no visible "jump" affordance, so the composer stays clean |
| **Turn-accurate context** | The quote block starts with `【引用 · 第3轮 · 你的消息】` followed by `> quoted text`, so the model knows exactly which turn and whose message |
| Turn-level quoting | Every finished turn gets `引用提问` / `引用回答` buttons that quote the whole question or answer |
| Anchors survive reload | The `ref → anchor` map is persisted in `localStorage` (per session, 60 entries max), so quotes still jump after a page refresh |

## Install

```sh
# from npm (recommended)
dsh plugin --profile <profile> add dsh-quote-annotate-pro

# from GitHub
dsh plugin --profile <profile> add github:zhao-guang-ai/dsh-quote-annotate-pro

# from a local clone (link install: edits apply instantly via HMR)
dsh plugin --profile <profile> add <absolute path to this repo>
```

Verified on **DSH 0.2.0-rc.2**, desktop profile (Windows). A page reload (or an automatic client-HMR reload) is needed after installation.

## How it works

```
select text
  │ bubble 「批注」→ editor → Enter
  ▼
emit('slash/input-insert-reference', { reference, span })      ← official session-scoped event
  │ the input machine mints one occurrence (source='quote-ref' / ref / label)
  ▼
composer chip (an official Lexical decorator node)
  │ on send, this plugin's codec serializes the ref
  ▼
【引用 · 第N轮 · 角色】
> quoted text
(comment)

jump back: quote bar / chip → [data-chat-anchor-key] row → scrollIntoView + highlight
```

Official surfaces used: `slots` (`shell.overlay`, `conversation.chat.turnTail`, `conversation.input.dock`),
`conversation.input` (draft + occurrences), `sessions.binding` / `sessions.scope`,
`inputTriggers.registerSource` + codec, and the DOM anchors `data-chat-anchor-key` / `data-chat-turn` / `data-chat-flow-kind`.

## Differences from upstream

**Compatibility fixes** (without these the plugin does nothing, silently):

1. Missing `inject: ['slots']` — `apply()` returned early before the service was ready; now declares the dependency and reports each registration step.
2. `conversation.chat.turnTail` became a **list** slot (was `chain`); the old `{ select, priority }` registration threw and aborted the 4 registrations after it.
3. `input.insertReference(...)` no longer exists — quoting fell back to plain text; now uses the `slash/input-insert-reference` session event.
4. `useSessions(s => s.current)` is always `undefined` in this version (the session-list snapshot has no `current` field) — clicking 「批注」 only closed the bubble. Now the session id comes from a session-scoped slot probe.

**Interface adaptations:** the turn-tail buttons read text from the **Chat snapshot** (`useChat`, `nodes` is a `Map`, identity is `anchorSeq`, assistant kind is `assistant-step`); composer chips have **no `data-*` attributes** any more, so the quote bar reads the official occurrence list instead.

## Development

```sh
npm run check    # manifest self-check (package.json / patch / bundle registration id)
npm run diag     # local diagnostics sink (http://127.0.0.1:47821)
```

`lib/client.js` is a hand-written bundle (no build step) — edit and save; the client HMR reloads it. See [README.md](./README.md) (Chinese) for the diagnostics channel and known limitations.

## Releasing (maintainers)

Releases go through **npm Trusted Publishing (OIDC)** — no token is stored in the repository and no one-time code is needed:

1. Bump `version` in `package.json` and note the change in `CHANGELOG.md`
2. Commit, tag and push:

   ```sh
   git tag -a v0.2.2 -m "v0.2.2"
   git push origin main --follow-tags
   ```

3. [`release.yml`](.github/workflows/release.yml) then checks the tag against the version, runs the syntax/manifest checks, and publishes with `--provenance` (SLSA attestation). An already-published version is skipped, so the workflow is safe to re-run.

Trusted Publisher configured on npm: `zhao-guang-ai` / `dsh-quote-annotate-pro` / workflow `release.yml` / environment `npm`.

## License

MIT — see [LICENSE](./LICENSE). Upstream: [`wangwei-wade/dsh-quote-annotate`](https://github.com/wangwei-wade/dsh-quote-annotate) (MIT, © 2026 wangwei-wade).
