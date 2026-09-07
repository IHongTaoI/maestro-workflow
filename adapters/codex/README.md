# Maestro Codex 插件（首版）

这是已有 Maestro Core Skill 的可选增强层，目标是 Codex 在 ChatGPT 桌面端的**本地项目**。
首版接通 `SessionStart`，覆盖 `startup / resume / clear / compact`。
压缩后，该 Hook 可在下一次模型请求前提供精简规则和记忆入口。

## 已实现的范围

- 提供协调、授权、Worker 等待和按需加载等少量 Core 提醒。
- 提供当前项目的 `SKILL.md`、Memory 和 Task 路径；只在文件存在时提供 Manifest / Index 路径。
- 提醒 Agent 依照 Core 检查索引是否过期，再按当前请求选择需要恢复的工作。
- 不读取 Memory 正文、Session transcript 或整份 Core，不把所有历史注入上下文。
- 没有有效 Codex 安装记录或 Core 文件时安静退出；嵌套仓库 / worktree 不借用父项目的状态。
- 输入或安装信息异常时跳过并输出诊断，不阻止 Codex，也不声称恢复成功。

**这不是自动 checkpoint**：尚未实现压缩前总结、写入进度、失败补存，也没有接通
`SubagentStart` 的 Worker Packet 映射或权限隔离。它只能帮助重新找到已经保存的状态，
无法恢复从未落盘的结论。因此这只是 #14 / #26 的部分落地。

插件没有第二份 `skills/maestro`，避免与已安装的 `.agents/skills/maestro/` 重复注册。
Core 仍由现有安装器维护；卸载插件后，裸 Skills 仍然可用。

## 从源码安装到桌面端（无需 npm 发布）

需要 Node.js 20.19+。在你的 Maestro 仓库根目录运行，例如 `D:\code\maestro-workflow`。

先确认目标项目已经安装 Core；如果已经安装，可直接执行 `doctor`：

```powershell
node .\bin\maestro.js init "D:\code\your-project" --tools codex
node .\bin\maestro.js doctor "D:\code\your-project"
```

然后准备个人插件来源：

```powershell
npm run codex:install:local
```

如果 PowerShell 拦截 `npm.ps1`，使用 `npm.cmd run codex:install:local`，或直接运行：

```powershell
node .\adapters\codex\install-local.mjs
```

该命令不需要构建、额外依赖或 Codex CLI。它会：

1. 将插件源文件准备到当前用户的 `~/plugins/maestro-codex/`。
2. 在 `~/.agents/plugins/marketplace.json` 添加个人来源条目，保留其他插件及已有展示名称和策略。
3. 输出准备完成的位置；**不会直接安装到 Codex 缓存、启用插件或授予 Hook 信任**。

这里的 `~` 指当前用户主目录（Windows 通常是 `C:\Users\你的用户名`）。从 Windows 原生
终端运行，以便桌面端能访问同一目录；在 WSL、容器或远程机器运行不会安装到 Windows 的用户目录。

接着刷新 / 重启桌面端，在 Plugins 中找到个人来源下的 **Maestro Codex**，安装并启用。
按照 Codex 的提示审查并信任这个 `SessionStart` Hook；安装插件不等于信任 Hook。
官方文档提供 Codex CLI 的 `/hooks` 用于查看、审查和信任 Hooks；如果桌面端缺少相应入口，
可在使用同一用户配置的 Codex CLI 中处理。不要绕过信任检查。

最后，在目标项目中新开对话，明确请求使用 Maestro。不要仅因插件安装成功就判断 Hook 已生效。
桌面端版本必须实际支持并允许执行上述事件；旧版本、未信任或禁用 Hooks 时，仍按裸 Skills 使用。
这里只验证本地项目；云端任务需要在其实际执行环境另外配置。

### 更新

更新 Maestro 仓库后，分别刷新 Core 和插件来源：

```powershell
node .\bin\maestro.js update "D:\code\your-project"
npm run codex:install:local
```

安装器会根据插件源码生成版本后缀。再到桌面端重新安装该个人来源的插件，并新开对话。
Codex 使用安装缓存，不应假设修改来源文件会立即影响已安装插件；如果提示 Hook 变化，重新审查。
安装器仅覆盖自己管理的三个插件文件及所有权标记，保留其他文件。
遇到同名但不同来源的插件、非 Maestro 管理的目录或损坏的 marketplace 时，会停止而不强行覆盖。
个人 marketplace 无需另行执行 `codex plugin marketplace add`。

### 关闭

在 Codex 中禁用 **Maestro Codex** 插件（或禁用其 Hook），新开对话验证。
这不会删除项目的 Core Skills 或 `.maestro/` 记忆。

## 最小桌面端验收

| 场景 | 应观察到的结果 |
| --- | --- |
| 已安装 Core 的本地项目，新开 Maestro 对话 | Hook 执行记录成功，输出包含当前项目的 Core 路径；不会自动创建 Task |
| 保存好一次进度后触发手动或自动压缩 | `SessionStart` 的 `source=compact` 执行；继续模型请求前补入提醒，再按需读取原有 Current State |
| 项目没有 Memory 或有多个候选任务 | 不虚构保存结果，不自行选一个旧任务继续 |
| 清空会话后问一个新问题 | 不把旧任务意图当成当前指令 |
| 未安装 Core 的另一个项目 | Hook 无上下文输出、不写 `.maestro/` |
| 禁用插件 / Hook 未信任 | 不再声称自动恢复 Hook 生效；已安装的 Core Skills 仍可显式使用 |

记录桌面端版本、执行环境、触发方式、Hook 执行状态和实际读取路径。
若客户端没有可用执行记录，只能记为“无法验证 Hook 是否运行”；模型说“我已恢复”不是证据。
自动测试覆盖协议与文件边界，不代表真实桌面端已通过验收。

## 开发验证

```bash
node --test test/codex-adapter.test.js
```

在仓库根目录执行。测试运行真实的 Hook launcher（包括带空格和特殊字符的插件路径），
不调用模型、不读取开发者真实会话；安装测试使用临时用户目录。根 `npm test` 已包含这些测试，
CI 另在 Windows 运行此套件。

## 官方接口依据

- [Codex Hooks](https://learn.chatgpt.com/docs/hooks)：`SessionStart`、`additionalContext`、插件默认 Hook 路径、Hook 信任。
- [插件打包和本地 marketplace](https://developers.openai.com/plugins/build/plugins)：个人来源、安装缓存和插件结构。

Hook 通过 Node 读取 `PLUGIN_ROOT`，避免把插件路径拼进 shell 代码；同一条命令用于 Windows 和 POSIX。
运行时只进行有界的安装元数据读取及路径检查，输出 JSON `hookSpecificOutput.additionalContext`。
不注册常驻服务，不调用模型 API，不改变 Codex 的权限、模型或工具配置。
