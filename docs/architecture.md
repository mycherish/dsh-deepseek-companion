# 架构（Architecture）

`dsh-deepseek-companion` 的长期架构。本文档描述目标形态，不代表当前已实现。

## 总览

```
DeepSeek Browser
        │
        ▼
      DSH Host
        │
 ┌──────┼─────────┐
 │      │         │
Auth  Browser  Conversation
State State     State
 │      │         │
 └──────┼─────────┘
        │
    HTTP / SSE
        │
   ┌────┴────┐
   ▼         ▼
Dock UI   Pop-out UI
```

## 核心原则

### Host 拥有状态，Client 只负责 UI

未来的核心状态全部由 Host 管理：

- Browser State
- Auth State
- Conversation State
- Message Store

React Client 只负责渲染，**不得**成为聊天状态的唯一 Owner。
这样 Dock 与 Pop-out Window 才能共享同一套状态。

### Host / Client 边界

- Host Runtime import 与 Type-only import 必须明确区分。
- 插件不能因为可选能力失败而导致整个 DSH Host 崩溃。
- 所有生命周期资源由 `ctx.effect` 管理。
- Browser、SSE、Timer、Connection 等资源必须支持 dispose。
- 不修改 DSH 源码实现插件功能。
- 不直接操作 DSH 内部数据库或私有文件格式。
- 不 monkey patch DSH。
- 不使用 DSH 私有 API。

### 兼容性策略

- 当前首要兼容目标：DSH 0.1.2-rc.1。
- 后续兼容其他版本时优先做 capability detection。
- 版本敏感 API 优先 `ctx.inject` / capability detection / type guard / runtime feature detection。
- 不假定所有 DSH 版本 API 一致。
- DSH API 不确定时先阅读官方源码/文档，不允许猜测。

## Companion Dock Surface Strategy（Phase 04 已验证）

Companion Dock 在用户点击 sidebar 入口时打开。打开时根据当前 Session 的 `blank` 标志，选择一个官方 Surface 占用：

| 当前 Session | Surface | 槽位 / Scope | 效果 |
|---|---|---|---|
| 非 blank（`blank === false`） | `details` | 单槽、`session` scope | conversation 真实缩窄，dock 在官方右侧列内 |
| blank（`blank === true`）或无当前 Session | `shell.overlay` | 列表槽、`root` scope | frame-right 浮层（fixed right 420px），conversation 不缩窄 |

### 规则

- Surface 在 `open()` 时只决定一次，open 期间不变。即便 Session 的 blank 状态发生变化，也不切换 Surface（避免 UI 跳动、焦点丢失、未来聊天输入状态被冲掉）。
- 只有 `close` → 再次 `open` 时才重新读取 Session blank 并选择 Surface。
- 任何时刻最多只有一个 Surface registration（details 或 overlay）。`close()` 调用对应的 `dispose`，DSH 默认 DetailsPanel 与 `shell.overlay` 容器都自动恢复原状。

### 原因

DSH 0.1.2-rc.1 的 `AppFrame` 在 `detailsSession === undefined`（即当前 Session 为 blank）时强制 `details` 宽度为 0；不存在合法公开 API 可以在不伪造 Host 语义的前提下把 blank Session 变 non-blank。因此 `details` 无法作为唯一 Surface。`shell.overlay`（`root` scope、不依赖 session、官方推荐的 frame-wide surface 座位）作为 fallback 保证「新建 Session 立即可用」的核心需求。

## Companion Dock Width（Phase 05A）

### 现状

- **overlay**：宽度由 Client 内存态 `dockWidth` 控制（默认 `420px`，`resize.ts` 的 `DOCK_DEFAULT_WIDTH`），左边缘提供 `col-resize` 拖动把手，通过 Pointer Capture（`setPointerCapture` / `releasePointerCapture`）+ `widthFromPointer` / `clampDockWidth` 实时调整。宽度仅在当前页面生命周期内有效，刷新后恢复默认（本阶段不做持久化）。
- **details**：DSH 0.1.2-rc.1 **不提供公开的 details 列宽修改 API**。`ctx.layout` 公开面（`ILayout`，`dsh-client-ui-layout/lib/types/client/service.d.ts`）只有 `toggleSidebar()` / `openDetails()` / `closeDetails()`；内部 store 的 `setDetails`（`stores.d.ts`）仅由 `AppFrame` 内置的 `DragHandle` 使用（`client.js` 的 `onDetailsDrag`），插件无法合法调用。因此 details 保持 DSH 默认宽度（`DETAILS_DEFAULT = 360`，min `300` / max `520`），并复用 DSH 自带的左侧拖动把手。

### 结论

- overlay resize ✅ 可合法实现。
- details resize ❌ 被 DSH 官方 API 限制（`ILayout` 无 `setDetails` / resize 方法，外部不能改 details 列宽）。
- 是否后续单独做 details 宽度兼容层，待架构决策（本阶段不实现，也不做宽度持久化）。
