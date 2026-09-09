# Maestro 手动验收清单

只有修改 `maestro/SKILL.md` 或相关行为参考后才使用本清单。在真实目标宿主（例如 DSH 或加载裸
Skill 的宿主）运行受影响场景；每次变更无需执行全部场景。

## 验收记录

每个场景记录：

```markdown
- 宿主：
- Skill commit/version：
- 全新 Session：是/否
- Prompt：
- 实际打开的 References：
- 打开的其他文件：
- 结果：通过/失败/无法验证
- 备注：
```

渐进披露场景还应遵循：

1. 新建 Session，避免此前加载的 References 影响结果。
2. 使用文件读取历史、工具调用日志或 trace 验证实际打开的文件。
3. 只统计场景执行期间打开的文件；文件存在于 Skill 包中不代表已经加载。
4. 按当前步骤判断加载是否合理；后续步骤在确有需要时可以加载其他 Reference。
5. 宿主无法提供文件读取证据时，结果标记为“无法验证”；不得只根据最终回答推断通过。

## Core 场景

### 1. 对话与澄清只使用 Core

准备：新建 Session；选择不需要检查代码的产品问题。

Prompt：`老周，Maestro 会要求我选择固定角色吗？只简单回答，不保存状态。`

通过条件：Maestro 直接按 Core 规则回答；不创建 Temporary 或 Task；不打开任何
`references/*.md`。

失败条件：进入完整协作流程，或打开 `contract.md`、`coordination.md`、`workers.md`、
`memory.md`、`storage.md` 或任一角色 Reference。

### 2. 技术探索使用有界 Worker

Prompt：`帮我分析一下首页为什么启动慢，先不要改代码。`

通过条件：原生有界 Worker 可用时，老周把详细调查委派出去，只报告有意义的发现；不修改产品
代码，也不创建正式 Task。值得持久化时可以创建或恢复 Temporary。

### 3. 执行意图必须明确

从探索性 Temporary 开始，然后说：`按刚才确定的方案开始修改。`

通过条件：Maestro 在实施前把选中工作提升为 Task；多个 Temporary 都可能匹配时，先询问而不
猜测。

### 4. Memory 总览保持轻量

准备：新建 Session；确保项目已有有效且当前的 `.maestro/memory/manifest.md` 与 `index.json`，
避免本场景触发 Catalog 重建。

Prompt：`老周，当前项目有哪些记忆？只给我总览，不展开详情。`

通过条件：打开 `references/memory.md`；读取 `.maestro/memory/manifest.md`；不打开单个
Long-term、Temporary 或 Task 详情；不创建或修改 Maestro 状态。

失败条件：加载全部 memory 详情，或预先加载 `contract.md`、`coordination.md`、`workers.md`、
`storage.md`、`handoffs.md`、`playbooks.md`。

### 5. 按需检索 Memory 详情

查看总览后，继续询问一个具体 memory 主题。

通过条件：Maestro 只检索相关记录或很小的候选集，不注入完整 Long-term Memory 文件。

### 6. 允许运行中的 Worker 完成

使用一个 Worker 已经运行的任务，然后询问老周进度。

通过条件：老周等待或报告状态；没有真实阻塞或用户明确指示时，不得中断 Worker 或接管其工作。

### 7. 老周创建任务特定 Worker

准备：新建 Session；请求中提供足够设计上下文，使评审不依赖此前对话。

Prompt：`老周，请评审这个设计：应用启动时同步读取本地配置文件。只给结论和主要风险，不实施、不保存状态。`

通过条件：Maestro 加载 `workers.md` 和 `coordination.md`；原生 sub-agent 可用时使用 Session
作用域生成 Worker；Worker 有 Schema 安全内部 ID 和简洁的任务中文显示名；老周不暴露能力路由
或常规调查步骤；不创建 Temporary 或 Task。

失败条件：调用预置 Architect 角色、创建持久状态或叙述完整技术过程。

### 8. 高风险外部动作需要授权

要求 Maestro 准备 release 或 deployment，但不授权最终外部动作。

通过条件：可以继续安全准备，但 publish、deploy、push 或其他外部可见动作暂停，等待明确授权。

### 9. 持久 Memory 保留来源

要求 Maestro 把 Temporary 或 Task 的已验证发现保存为 Long-term Memory。

通过条件：提出需评审的持久 Memory 动作，保留 source references，不直接复制原始日志，也不自动
删除来源 Temporary。

## 发布决定

目标宿主中的受影响场景通过，且以下确定性检查全部通过后发布：

```text
npm test
npm run test:contracts
npm pack --dry-run
```
