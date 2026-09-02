# @maestro-ai/dsh-adapter

DeepSeek Harness (dsh) 的 Maestro 适配层。它把可移植的 Maestro Core Skill 挂进 dsh，并在
dsh 的 `ctx.fs` 原语之上提供确定性的状态写协议。这是 [Issue #14][issue-14]「Core 可移植 +
可选 Harness Plugin / Adapter」方向的第一个宿主实现。

> **当前接线状态（如实）**：本 PR 只完整交付了 **Product A**（把 Core 注册成 dsh skill）。
> `ctx.fs` 存在时，确定性的 `MaestroStateStore` 与 `MaestroSchemaValidator` 会被构建并注册成
> Cordis service（`maestro.stateStore` / `maestro.schemaValidator`），但**尚未暴露成
> model-facing tool**，因此 Core 的实际执行链还不经过它们——锁 / CAS / 校验目前是"机制就绪、
> 未接入模型"的状态。`ctx.agents` 仅用于能力探测，没有注册任何生命周期 handler（Handoff /
> session-boundary 决策逻辑还在 Core Skill 里，属 TODO）。详见下文「落地顺序」。

> **Worker Delegation Contract**：当前 Adapter 尚未实现 Worker Delegation Packet 到 dsh
> subagent prompt / tool isolation 的映射，因此不能对独立 Worker 执行宣称 `supported`。在该映射
> 完成前，Core 可以在当前 Agent 中直接执行同一份契约，但必须如实描述为本地 fallback；若要求
> 独立 Worker 隔离，则应报告 `unsupported`，不能假设子 Agent 自动继承父 Skill 或权限。

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

### 本地仓库一键安装（无需发布 npm）

在仓库根目录运行：

```powershell
npm run dsh:install:local -- --profile web
```

如果 PowerShell 的执行策略拦截 `npm.ps1`，把命令开头的 `npm` 换成 `npm.cmd` 即可。

该命令会安装 adapter 的构建依赖，生成包含当前 Maestro Core 的本地 `.tgz`，并把它安装进
`~/.dsh/profiles/web/`。DSH 会根据包内的 `dsh.bundle` 声明自动把它加入 profile，随后加载包内
的 `cordis.patch.yml`：

```yaml
- insert:
    - id: maestro-adapter
      name: '@maestro-ai/dsh-adapter'
      inject:
        - skills
```

安装包保存在 `~/.dsh/local-packages/<profile>/`，不会使用容易在 Windows 上生成错误 junction
的本地目录 `link:`。安装器最后会验证包入口、随包 Core、`dsh.profile.bundles` 和
`dsh --dump-config`。如果旧 profile 里存在手工添加的 Maestro insert，安装器会移除该重复项，
改由包的 bundle 激活；新 profile 默认使用包内 `lib/core/`。

常用选项：

```text
--profile <name>       目标 profile，默认 web
--dsh-home <path>      自定义 DSH home
--skip-dependencies    已安装依赖时跳过 npm install
--no-verify            跳过最终 DSH 配置验证
```

### 包构建

adapter 通过 `prepack` 自动构建：

```bash
cd adapters/deepseek-harness
npm install
npm pack
```

构建会输出 ESM 入口、类型声明和当前 Maestro Core 到 `lib/`。`lib/` 不提交 Git，但会进入
生成的 npm tarball。安装运行时不需要 TypeScript、tsx 或 esbuild。

### Cordis 调用

把 `maestro/` 目录作为 Core 传入，插件在 `apply()` 时读取 `SKILL.md` 的 frontmatter
（`name` / `description`）并用 `ctx.skills.register()` 注册为运行时 skill，`references/`
和 `schemas/` 通过 `resourceBase: { kind: 'directory' }` 暴露给模型按需加载。

```ts
import adapter from '@maestro-ai/dsh-adapter'

// 在 Cordis profile / bundle 里挂载
export const name = 'maestro-adapter'
export const inject = ['skills']
export function apply(ctx, config) {
  adapter.apply(ctx, config)
}
```

`Config.coreDir` 指向 Maestro Core 的 `maestro/` 目录（含 `SKILL.md`）。缺省时按
`process.cwd()/.dsh/skills/maestro` → `process.cwd()/maestro` → adapter 包内 `lib/core/` 的
顺序探测。

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
| 状态路径边界 | 每次解析都走 `ctx.fs.contains(.maestro/, target)` 做权威 containment 校验，`lockPathFor` / 状态路径再拒绝 `..` 与绝对路径 |
| schema 校验 | 复用 `maestro/references/schemas/*.json`（JSON Schema draft 2020-12），用 `ajv` 校验 |
| Worker 指令与上下文注入 | 尚未接线；独立 Worker 必须报告 `unsupported`，不能静默继承父上下文 |

## 锁协议（`acquireLock`）

dsh `ctx.fs` 目前没有 delete/remove 原语，锁不能像 `storage.md` 那样删目录释放，因此用**文件 +
租约 + tombstone** 实现，语义对齐 `storage.md`：

- **独占获取**：`createIfAbsent` 写 `{ owner, acquiredAt, expiresAt, state: 'held' }`。
- **正常释放**：release 把锁写成 `state: 'released'` tombstone（guarded replace，只覆盖自己
  拿到的那一版）。下一个 writer 看到 `released` 立即回收，**不必等租约过期**。
- **过期回收**：`storage.md` 明确「clock age alone is insufficient」——已过期但仍 `held` 的锁
  只有在调用方通过 `canReclaim(lease)` 确认原 owner 确已不活跃后才被回收；**不提供
  `canReclaim` 时绝不自动强抢**，超时后 surface conflict。回收走 `replaceIfVersion` CAS，
  并发回收者只有一个能赢。
- 调用方在授权回收后，仍须按 `storage.md` 在 transaction / Evidence 里记录「原 owner、过期
  时间、回收者、时间戳」。

## 与 `storage.md` 的已知偏差

- **锁是文件而非目录**：`storage.md` 规定锁是 `.maestro/locks/<key>.lock/` 目录，但 dsh `ctx.fs`
  没有"创建目录"原语，适配层用同名**文件**实现，排他语义等价。
- **锁靠 tombstone + 租约而非删除释放**：因无 delete 原语，release 是写 `released` tombstone
  而非删锁；回收过期锁依赖调用方 `canReclaim` 确认 owner 不活跃，符合 `storage.md` 的保守回收
  要求。

## 目录结构

```text
adapters/deepseek-harness/
├── build.mjs
├── cordis.patch.yml
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── README.md
├── scripts/
│   ├── install-local.mjs
│   ├── install-local.test.mjs
│   └── check-package.mjs
├── lib/             # 构建产物，不入 Git；发布包中包含
│   ├── index.js
│   ├── index.d.ts
│   └── core/        # 打包时从 ../../maestro/ 复制
└── src/
    ├── index.ts        # 唯一插件入口，唯一 import dsh API 处；注册 Core skill + 提供 storage service
    ├── types.ts        # Config 与共享类型
    ├── detect.ts       # capability detection + fallback 决策
    ├── skill.ts        # 产物 A：注册 Core 为 dsh skill
    ├── storage.ts      # 产物 B：ctx.fs 上的锁 / CAS 写协议（含 .maestro/ 边界强制）
    ├── validate.ts     # 产物 B：schema 校验
    ├── hooks.ts        # 产物 B：turn-stopping 监听原语（正确 await，尚未接线）
    ├── storage.test.ts # storage / lock 单元测试（fake seam）
    └── hooks.test.ts   # hooks 监听原语单元测试（fake ctx）
```

## 测试

```sh
cd adapters/deepseek-harness
npm install
npm run typecheck   # tsc --noEmit
npm test            # tsx --test src/*.test.ts
npm run test:package
```

`storage` 与 `hooks` 模块只有 type-only 的 `@deepseek-ai/*` 导入，测试用一个内存 fake seam /
fake ctx 即可覆盖锁 / CAS / 边界 / await 语义，无需真实 dsh runtime。

## 落地顺序

1. ~~产物 A：skill 注册~~（本 PR）
2. ~~detect 骨架 + fallback~~（本 PR）
3. ~~storage 的锁 / CAS 写 + `.maestro/` 边界强制~~（本 PR，含单测）
4. ~~hooks 的 turn-stopping 监听原语（正确 await）~~（本 PR，含单测，但未接线）
5. 把 store / validator 暴露成 model-facing tool，让 Core 的 storage 协议真正跑在 CAS 实现上——后续
6. 事务（`storage.md` 的 `transactions/` 多文件原子提交）——后续
7. session hooks 的完整生命周期联动（Handoff / Memory 保存）——后续
8. 将 Worker Delegation Packet 映射到 dsh subagent 指令、上下文、工具与权限隔离，并返回真实
   `supported` / `degraded` / `unsupported` 状态——后续

[issue-14]: https://github.com/IHongTaoI/maestro-workflow/issues/14
