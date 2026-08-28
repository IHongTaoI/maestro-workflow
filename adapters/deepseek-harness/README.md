# @maestro-ai/dsh-adapter

DeepSeek Harness (dsh) 的 Maestro 适配层。它把可移植的 Maestro Core Skill 挂进 dsh，并在
dsh 的 `ctx.fs` 原语之上提供确定性的状态写协议。这是 [Issue #14][issue-14]「Core 可移植 +
可选 Harness Plugin / Adapter」方向的第一个宿主实现。

> dsh 目前是 v0.1 开发者预览版，官方 README 明确「THERE WILL BE COMPATIBILITY-BREAKING
> CHANGES」。本适配层把对 dsh API 的引用收敛到 `src/` 内的 TypeScript 类型导入，Core 永不
> import 任何 `@deepseek-ai/*` 包。

## 架构边界

| 层 | 职责 | 本仓库位置 |
| --- | --- | --- |
| **Maestro Core** | 角色调度、三层记忆语义、Handoff 边界、Playbook 规则（宿主无关） | `../../maestro/` |
| **Skill adapter（薄）** | 把 Core 注册成 dsh skill | `src/skill.ts` |
| **Capability plugin（厚）** | 锁 / 原子写 / 事务、schema 校验、session 生命周期 | `src/storage.ts`、`src/validate.ts`、`src/hooks.ts` |
| **detection + fallback** | 探测 dsh 提供了哪些 seam，按能力降级 | `src/detect.ts` |

红线（来自 Issue #14 验收标准）：

1. Core 不直接依赖宿主专有 API。
2. Adapter 不复制 Maestro 的业务决策逻辑。
3. 移除 Adapter 后，Maestro Core 仍可基本运行。

## 用法

把 `maestro/` 目录作为 Core 传入，插件在 `apply()` 时读取 `SKILL.md` 的 frontmatter
（`name` / `description`）并用 `ctx.skills.register()` 注册为运行时 skill，`references/`
和 `schemas/` 通过 `resourceBase: { kind: 'directory' }` 暴露给模型按需加载。

```ts
import adapter from '@maestro-ai/dsh-adapter'

// 在 Cordis profile / bundle 里挂载
export const name = 'maestro-adapter'
export const inject = ['skills']
export const Config = adapter.Config

export function apply(ctx, config) {
  adapter.apply(ctx, config)
}
```

`Config.coreDir` 指向 Maestro Core 的 `maestro/` 目录（含 `SKILL.md`）。缺省时按
`process.cwd()/.dsh/skills/maestro` → `process.cwd()/maestro` 的顺序探测。

## Capability detection 与降级

`src/detect.ts` 启动时探测以下 seam（用 `ctx.get()` 而非 `inject`，因为它们可选）：

| Seam | 探测键 | 有 → | 无 → |
| --- | --- | --- | --- |
| skill registry | `ctx.skills` | 注册 Core（必需） | 报错（无 skill 无法工作） |
| filesystem | `ctx.fs` | 启用 `storage`（锁 + CAS 写） | 降级：Core 按 `storage.md` 文字协议自行用文件工具 |
| agent registry | `ctx.agents` | 启用 `hooks`（session 生命周期） | 降级：不监听 agent 事件 |

降级到纯 skill 模式时，Maestro Core 仍可用——只是锁 / 原子写 / 校验由模型自行按 Core 里的
文字协议执行，可靠性下降但不丢失功能。这对应 Issue #14 的「无 Plugin 也必须能运行」。

## 关键 API 映射

| Maestro 概念 | dsh 原语 |
| --- | --- |
| `revision`（`storage.md`） | `ctx.fs` 的 `FsVersion`（`stat()` 返回的不透明版本 token） |
| 原子替换 + 冲突检测 | `ctx.fs.writeText(target, content, { kind: 'replaceIfVersion', version })`；冲突抛 `FS_STALE_VERSION` |
| 独占锁 create-if-absent | `ctx.fs.writeText(lockTarget, owner, { kind: 'createIfAbsent' })`；已存在抛 `FS_NOT_OBSERVED` |
| 路径遍历防护 | `ctx.fs.contains(parent, child)`；`lockPathFor` 额外拒绝 `..` 与绝对路径 |
| schema 校验 | 复用 `maestro/references/schemas/*.json`（JSON Schema draft 2020-12），用 `ajv` 校验 |

## 与 `storage.md` 的已知偏差

- **锁是文件而非目录**：`storage.md` 规定锁是 `.maestro/locks/<key>.lock/` 目录，但 dsh `ctx.fs`
  目前没有"创建目录"原语，适配层用同名**文件** + `createIfAbsent` 实现，排他语义等价。
- **租约式锁**：dsh `ctx.fs` 暂无 delete/remove 原语，锁文件无法在 release 时删除。`acquireLock`
  因此写入 `owner` + `expiresAt` 租约；已存在的锁只有在租约过期后才可被回收，回收本身走
  `replaceIfVersion` CAS（并发回收者只有一个能赢）。调用方仍需按 `storage.md` 确认原 owner 已
  不活跃，并在 transaction / Evidence 里记录回收行为。

## 目录结构

```text
adapters/deepseek-harness/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts      # 唯一插件入口，唯一 import dsh API 处
    ├── types.ts      # Config 与共享类型
    ├── detect.ts     # capability detection + fallback 决策
    ├── skill.ts      # 产物 A：注册 Core 为 dsh skill
    ├── storage.ts    # 产物 B：ctx.fs 上的锁 / CAS 写协议
    ├── validate.ts   # 产物 B：schema 校验
    └── hooks.ts      # 产物 B：agent 事件 → session 生命周期（骨架）
```

## 落地顺序（后续）

1. ~~产物 A：skill 注册~~（本 PR）
2. ~~detect 骨架 + fallback~~（本 PR）
3. storage 的锁 / CAS 写（本 PR 提供基础实现）
4. 事务（`storage.md` 的 `transactions/` 多文件原子提交）——后续
5. session hooks 的完整生命周期联动——后续

[issue-14]: https://github.com/IHongTaoI/maestro-workflow/issues/14
