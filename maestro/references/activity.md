# 项目活动时间线

Activity 回答“这个月完成了什么”“今年做过哪些事”。它是从现有权威记录生成的查询视图，
不是第四层 Memory，也不是新的权威状态源。删除 `.maestro/activity/index.json` 不会丢失事实；
下一次查询可以重建。

## 当前范围

第一阶段只派生 `task_completed`：

- 来源是 `.maestro/tasks/**/task.yaml`，包括 `tasks/archive/`；
- Task 的 `status` 必须是 `completed` 或 `archive`；
- `occurred_at` 只取显式 `completed_at`，并归一化为 UTC；
- `source_refs` 指向 Task 当前所在的 `task.yaml`。Task 移入 archive 后，重建会刷新引用路径；
- 事件 ID 由 Task ID 和 `completed_at` 确定性生成，同一 Task 不会重复出现。

旧 Task 没有 `completed_at` 时跳过。不要用 `updated_at`、Git 时间或文件 mtime 猜测事件时间。
Decision 等记录只有在拥有统一、可靠的生命周期时间及明确投影规则后才能加入。

## 写入规则

Activity 没有 `record` 操作，也不维护 `events/*.jsonl`。完成新 Task 时，在 Task 生命周期更新中
写入并保留 `completed_at`；Activity 只负责读取和派生。Task 来源损坏、重复 ID 或时间格式无效时，
构建必须明确失败，不能静默跳过有问题的权威记录。

## 查询协议

用户询问时间范围内做过什么时，运行受限查询，不要直接读取完整 `activity/index.json`：

```text
python maestro/scripts/activity_catalog.py --project-root <root> search --month 2026-09
python maestro/scripts/activity_catalog.py --project-root <root> search --year 2026
python maestro/scripts/activity_catalog.py --project-root <root> search --from 2026-09-01 --to 2026-09-30
```

查询默认最多返回最近 50 条，`--limit` 范围为 1–200。只在用户需要细节时，再读取结果中少量
`source_refs`。Index 缺失、损坏或来源变化时，查询会自动重建；`--no-refresh` 只用于检查调用方
是否错误依赖旧缓存。

维护命令：

```text
python maestro/scripts/activity_catalog.py --project-root <root> build
python maestro/scripts/activity_catalog.py --project-root <root> check
```

`build` 原子写入派生 Index。`check` 只判断现有 Index 是否有效且与当前 Task 来源一致，不修改文件。
