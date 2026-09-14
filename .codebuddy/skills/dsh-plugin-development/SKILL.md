---
name: dsh-plugin-development
description: 用于开发、修改、调试和审查 dsh-deepseek-companion 及 DeepSeek Harness 0.1.2-rc.1 插件代码，涵盖 Cordis、DSH Client、Slots、Layout、Host/Client 生命周期和兼容性约束。
---

# DSH Plugin Development

本 Skill 固化 dsh-deepseek-companion 项目通过源码调查与真实浏览器验证确认的 DSH 0.1.2-rc.1 插件开发知识，用于快速调用领域事实。只记录已验证事实，不含推测。

更完整的工程规范见 `AGENTS.md`，架构见 `docs/architecture.md`，路线图见 `docs/roadmap.md`。本 Skill 只提供 DSH 插件开发时需要的领域知识，不重复上述文档。

## 运行环境

- 目标 DSH：`@deepseek-ai/dsh@0.1.2-rc.1`
- Cordis：`@deepseek-ai/cordis@4.0.2`
- Node：`>=22`（不锁定精确小版本）
- 技术栈：TypeScript + ESM + React Client + tsdown + pnpm

## Host Plugin 结构

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'deepseek-companion'

export function apply(ctx: Context): void {
  // ...
}
```

规则：

- 优先公开 DSH / Cordis API。
- 用 `ctx.inject`（模块级 `export const inject = [...]`）声明服务依赖。
- 生命周期资源用 `ctx.effect` 管理，返回 disposer。
- 可选能力失败不得拖垮 DSH Host。
- 不 monkey patch DSH、不修改 node_modules、不访问 DSH 私有 store 代替公开 API。

## Host Route 注册生命周期（Phase 06B 已验证）

DSH 0.1.2-rc.1 中 `ctx.connection.fetch.register(route)`：

- **返回 disposer**，调用它可移除 route。
- **重复 path 会抛错**（`already registered`）。
- 其内部清理（`owner.effect(...)`）绑定的 `owner = HostConnectionService.ctx`，即 **dsh-client-connection 自己的 Context**，**不是**调用它的第三方插件 Context。
- 因此**不要假设 `Service.ctx` 是调用插件的 ctx**；第三方插件注册 Route 必须自己管理生命周期：

```ts
ctx.effect(() => ctx.connection.fetch.register({ ... }), 'label')
```

这样插件卸载（dispose/reload）时 Route 才会一起注销，避免残留 route 和重复注册报错。

## DSH Bundle 配置

`package.json`：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

`cordis.patch.yml` 用 `- insert` 插入插件：

- `id`: `deepseek-companion`
- `name`: `dsh-deepseek-companion`

只插入当前插件，不删除/替换 DSH 默认 bundle，不修改 preset。不要复制旧版本 DSH bundle 配置。

## DSH Client Plugin 结构

`package.json`：

- `exports["./client"]` 指向浏览器端入口。
- `dsh.client.platform = "web"`。
- `dsh.client.inject = [...]`（包名依赖边）。

Client 入口同 Host 形状：`export const inject = [...]` + `export function apply(ctx)`。

**关键**：DSH 0.1.2-rc.1 的浏览器 Client bundle 不是普通独立 ESM 页面，而是 `window.__ModuleLoader__.load(...)` 格式的 bundle。不要擅自改成普通 browser ESM bundle，除非先验证当前 DSH loader 机制已变化。

## React 规则

- React / ReactDOM 由 DSH Web Host 提供。
- 插件**不得**打包第二份 React Runtime（会引发 duplicate React）。
- React / ReactDOM 保持 peer dependency，类型包（`@types/react` 等）为 dev dependency。

## Slot 系统（已验证）

| Slot | kind | scope | 用途 / 事实 |
|---|---|---|---|
| `sidebar.footer.action` | list | root | 当前用于 `DS DeepSeek` 入口 |
| `details` | single | session | DSH 默认 DetailsPanel 占用；Companion 临时 shadow 用 `priority: -1`（默认 occupant `priority: 0`） |
| `shell.overlay` | list | root | frame-wide 浮层，官方支持的 Shell Surface；容器 `pointer-events: none`，条目需 `pointer-events: auto` |

- `ctx.slots.register(...)` 返回 disposer；dispose 后默认 occupant 自动恢复 `active`（`entriesOfSlot` 重新投影到下一个 survivor）。
- 不存在 `right-panel` / `fourth-column` / `additive-details` 扩展点，不要使用。

## details 的 blank 限制（最重要兼容事实）

DSH 0.1.2-rc.1 的 `AppFrame` 只有当前 Session `blank === false` 时才给 `details` 列实际宽度。

blank Session 下，即使 `register` 成功、occupant `active: true`、`ctx.layout.openDetails()` 成功，`AppFrame` 仍把 details 宽度视为 0（列不显示）。

**禁止假设 details 可用于 blank Session。**

## Companion 展示策略（v0.0.3 已验证）

打开 Companion 时读取当前 Session `blank` **一次**：

- `blank === true` 或没有可用 non-blank Session → `shell.overlay`
- `blank === false` → `details`

展示方式只在 `open()` 时决定一次。Companion 打开期间即使 Session 从 blank → non-blank，也**不要**自动从 overlay 切到 details（避免布局跳动、焦点丢失、滚动变化、未来 Composer 输入状态丢失）。只有 close → 再 open 才重新判断。

## details 动态占用（正确生命周期）

不要在插件加载时永久 shadow DSH DetailsPanel。

- open non-blank：`register` Companion into `details` → `ctx.layout.openDetails()`
- close：`ctx.layout.closeDetails()` → dispose Companion details registration
- dispose 后 DSH 默认 DetailsPanel 恢复 `active`
- 任何时候最多只有一个 Companion registration（用 `open` 标志 + disposer 判空防重复）

## Session 状态规则

通过 `@deepseek-ai/dsh-api-session-controller` 的公开只读 API `ctx.sessions.list` 读取 Session 信息（`current` / `blank` / `phase` 等）。

严禁：直接改 `session.blank`、改 `blankBit`、伪造 `running`、改 Session 私有 Store、发送隐藏 prompt、创建假消息。不要为了让 details 可用而污染 Session 语义。

## Layout 规则

`ctx.layout.openDetails()` / `ctx.layout.closeDetails()` 属于 DSH 官方 Layout Service。

不要通过 `document.querySelector`、`MutationObserver`、`appendChild`、直接改 DSH 主 DOM、monkey patch `AppFrame` 来实现右侧面板。若官方 Layout/Slot API 不满足需求，先停止并调查，不自动采用 DOM Hack。

## Width Ownership（谁拥有布局，谁拥有宽度）

宽度归属是稳定架构事实：

- `shell.overlay`：Companion owns width。自定义 resize handle，宽度持久化到浏览器 localStorage（key：`dsh-deepseek-companion:overlay-width`）。
- `details`：DSH owns width。使用 DSH 原生 DragHandle，Companion 不控制、不持久化、**禁止同步** details 宽度。

overlay 与 details 宽度故意独立，绝不相同步，也不把 localStorage 的 overlay 宽度应用到 details。

## Host / Client 边界

长期架构：Host 拥有未来的 Browser State、Auth State、Conversation State、Message Store；Client 只负责 UI（Dock open/close、展示方式、Resize width、滚动等纯 UI 状态）。

不要把 DeepSeek 会话、消息、认证、浏览器生命周期长期存进 React Component state。

## 后续 Browser 约束（工程约定）

未来 Browser Engine 使用 Playwright 时：Browser 生命周期属于 Host；selector 集中管理；使用有限 timeout/retry；登录走 DeepSeek 官方页面；不记录 Cookie/Token/密码；Browser/Profile 数据不得进入 Git。具体 selectors 尚未实现，不要提前写。

## DSH API 兼容原则

DSH API 变化较快。禁止因旧项目示例存在就直接复制旧 API——旧版 `dsh-web-chat` 曾使用旧 Client Runtime / Slot API，不能直接视为 0.1.2-rc.1 官方结构。

遇到版本敏感 API，优先级：

1. 阅读本机目标版本源码
2. 阅读当前官方文档
3. capability detection
4. type guard
5. dynamic fallback

不要猜。

## 开发流程

每次只完成当前 Phase；修改后执行 `pnpm typecheck`、`pnpm build`、`pnpm test`、`git diff --check`；未经用户批准不 commit、不 push、不进入下一 Phase。完整 Git 规范见 `AGENTS.md`。
