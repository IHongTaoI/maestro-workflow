# Activity 时间线设计

## 背景

Long-term Memory 回答“项目现在知道什么”，不会保存完整工作流水。Issue #54 需要回答“这个月
完成了什么”，但 Activity 不能成为第四层 Memory，也不能复制一份会与 Task、Decision、Memory
或 Playbook 分叉的事实。

## 权威边界

现有 Task、Decision、Memory、Playbook 和 Worker 记录继续是唯一权威来源。Activity 只保存一个
可删除、可重建的本地查询缓存：

```text
.maestro/activity/
  index.json  # 从权威记录确定性派生，不纳入 Git
```

不存在 Activity 事件日志或手工 `record` 接口。这样无需解决第二套权威数据的并发追加、迁移和
一致性问题，也不会要求各生命周期调用点同时写两份状态。

## Task 完成事件

当前权威格式中，只有 Task 能形成最小且可靠的自动闭环。Task 进入 `completed` 或 `archive`
终态时，在同一次生命周期更新中写入一次 `completed_at`。目录构建器扫描活动及归档 Task，生成：

```json
{
  "event_id": "activity-20260910-<stable-hash>",
  "occurred_at": "2026-09-10T12:00:00Z",
  "event_type": "task_completed",
  "title": "完成老周单入口重构",
  "summary": "完成 Task：完成老周单入口重构",
  "source_refs": [".maestro/tasks/archive/20260910-老周单入口/task.yaml"],
  "status": "completed"
}
```

- `event_id` 由事件类型、Task ID 和归一化后的 `completed_at` 确定性生成；
- `occurred_at` 只来自显式 `completed_at`；
- 旧 Task 缺少 `completed_at` 时保持兼容，但不进入时间线；
- `updated_at`、文件 mtime 和 Git 时间都不能替代事件时间；
- `source_refs` 每次从 Task 当前路径生成，Task 移入 archive 后会自动刷新；
- 重复 Task ID、损坏 YAML、无效时间或越界引用必须使构建失败，不能静默忽略。

## Decision 里程碑事件

Decision 使用独立的不可变权威记录：

```text
.maestro/memory/long-term/decisions/<decision-id>.decision.json
```

记录显式保存 `decided_at`、`outcome` 和 `importance`。Activity 只投影 `importance: milestone` 的
`approved` 与 `superseded`，分别生成 `decision_approved` 和 `decision_superseded`。`routine` 与
`rejected` 保留审计价值但不进入用户时间线。`source_refs` 指向 Decision Record 本身，证据再由
Record 内的来源追溯。

旧 Decision 不要求迁移。只有直属目录、扩展名为 `.decision.json` 且通过 schema 校验的新记录才
参与派生；不得从更新时间、文件 mtime 或 Git 时间推断 `decided_at`。

## 构建和失效判断

构建器对所有规范 Task 和 Decision 来源的相对路径及文件内容计算 SHA-256 `source_digest`。因此
Task 状态变化、移入 archive，以及 Decision Record 新增或变更都会使旧 Index 失效。构建结果原子写入
`.maestro/activity/index.json`；缺失或损坏时查询自动重建。

## 查询协议

```text
activity_catalog.py --project-root <root> search --month 2026-09
activity_catalog.py --project-root <root> search --year 2026
activity_catalog.py --project-root <root> search --from 2026-09-01 --to 2026-09-30
```

查询只返回所选窗口，默认最多 50 条、最多允许 200 条。老周不直接把完整 Index 读入上下文；只有
用户需要详情时才读取少量 `source_refs`。

## 完成标准

1. 新完成 Task 无需额外记录命令即可出现在查询中；
2. 旧 Task 不会被猜测时间；
3. Task 归档后事件不丢失，引用指向当前文件；
4. Index 缺失、损坏或陈旧时可安全重建；
5. 不生成 `events/*.jsonl`，Activity 不成为权威源；
6. 里程碑级批准和取代 Decision 使用显式 `decided_at` 进入时间线；
7. routine、rejected 和旧格式 Decision 不进入时间线，也不猜测时间；
8. 月、年和任意日期范围查询有边界且结果数量受限。
