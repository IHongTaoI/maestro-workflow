# Checkpoint Recovery Activity 设计

## 目标与边界

Issue #66 只把具有用户价值的恢复完成结果投影到 Activity，不改变 checkpoint/recovery
本身的保存、冲突或恢复语义。

Activity 仅纳入一次事件：一个尚未提交的 checkpoint 请求通过显式 `retry` 成功提交。
事件类型为 `checkpoint_recovered`。普通 `save` 成功、自动 checkpoint、
`already_committed`、`inspect`、`status`、CAS 冲突、失败记录和锁操作都不投影。

这样 Activity 表达的是“项目从一次可恢复故障中恢复完成”，而不是内部保存频率。

## 权威记录

恢复真正完成的边界是 `retry` 已确认 canonical 内容等于请求的 `proposal_hash`，并成功发布
不可变的 `<request_id>.committed.json`。新 observation 增加：

```json
{
  "request_id": "maestro-checkpoint-example-1",
  "record_hash": "...",
  "proposal_hash": "...",
  "revision": 8,
  "completion": "recovery",
  "committed_at": "2026-09-12T11:28:04.506Z"
}
```

`completion: recovery` 只能由 `retry` 的成功路径写入。普通 `save` 发布的新 observation 使用
`completion: save`，用于协议验证但不进入 Activity。`committed_at` 在 observation 首次发布时
生成并保持不可变，是 Activity 唯一认可的事件时间。

旧 observation 不迁移。它们继续参与既有幂等与提交状态判断，但因为缺少 `completion` 或
`committed_at`，Activity 不猜测时间，也不投影事件。`updated_at`、失败事件的 `recorded_at`、
文件 mtime 和 Git 时间均不能替代恢复完成时间。

## Observation 验证协议

当前实现通过重新生成无时间 observation 后做逐字比较。加入权威时间后，读取方改为解析并
验证 observation：

- `request_id`、`record_hash`、`proposal_hash`、`revision` 必须与请求记录严格一致；
- 新格式必须同时包含 `completion` 和带时区的 `committed_at`；只出现其中一个属于损坏；
- `completion` 只允许 `save` 或 `recovery`；
- 旧格式只能是原有四字段形式，仍按旧规则接受；
- 多余字段、无效时间、字段不匹配或无法解析均明确报 `invalid_observation`。

不可变写入与现有锁、CAS、secondary recovery 规则保持不变。Activity 的读取或重建不参与
checkpoint 提交事务，也不能影响恢复是否成功。

## Activity 派生

派生器扫描规范 Task 与 Temporary 的 checkpoint observation 目录，包括活动和归档目标。
它只读取直属 `*.committed.json`，并以相邻的 `<request_id>.json` 请求记录作为绑定依据。

仅当 observation 通过原生等价约束、`completion` 为 `recovery` 且存在合法 `committed_at` 时，
生成：

```json
{
  "event_type": "checkpoint_recovered",
  "occurred_at": "2026-09-12T11:28:04Z",
  "title": "恢复 checkpoint：验证 DSH checkpoint",
  "summary": "恢复 Temporary 20260912-验证DSH-checkpoint 到 revision 8",
  "source_refs": [
    ".maestro/memory/temporary/active/20260912-验证DSH-checkpoint/references/checkpoints/maestro-checkpoint-example-1.committed.json"
  ],
  "status": "completed"
}
```

稳定事件身份由 `checkpoint_recovered`、目标种类、目标 ID、`request_id` 和归一化后的
`committed_at` 生成。重复查询、重复 `retry` 和 Activity 重建得到同一个事件 ID。

所有规范来源都参与 `source_digest`。Activity Index 缺失、损坏或陈旧时仍可重建；删除
`.maestro/activity/index.json` 不会修改请求、canonical 状态、failure event 或 observation。

## 错误与兼容策略

- 没有新时间字段的旧 observation：合法但不投影；
- observation 存在而请求记录缺失：权威链损坏，构建失败；
- JSON、字段、哈希、revision、时间或目标路径非法：构建失败；
- 同一规范目标出现重复 request identity：构建失败；
- secondary-only 记录尚未恢复时没有 committed observation，因此不投影；
- 历史 failure event 可保留审计价值，但不是 Activity 来源。

## 验证计划

1. Adapter 测试覆盖 save/retry 写入不同 `completion`，时间不可变，以及旧/新 observation 验证。
2. Schema 与原生 validator fixtures 覆盖 `checkpoint_recovered` 合法事件及未知类型失败。
3. Activity 测试覆盖 Task/Temporary、活动/归档、时间窗口、稳定 ID、重建去重、旧记录跳过。
4. 损坏 observation、缺失请求、哈希/revision 不匹配、无效时间和越界路径必须显式失败。
5. 删除 Activity Index 后重建，确认 checkpoint/recovery 权威文件字节不变。

