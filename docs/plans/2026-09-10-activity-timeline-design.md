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

## 第一阶段：Task 完成事件

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

Decision 暂不进入第一阶段，因为当前记录没有统一且明确的批准时间字段。等权威格式定义批准时间
及投影规则后，再单独扩展事件类型；不能从更新时间推断。

## 构建和失效判断

构建器对所有 Task `task.yaml` 的相对路径和文件内容计算 SHA-256 `source_digest`。因此 Task 状态
变化、内容修改或从活动目录移动到 archive 都会使旧 Index 失效。构建结果原子写入
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
6. 月、年和任意日期范围查询有边界且结果数量受限。
