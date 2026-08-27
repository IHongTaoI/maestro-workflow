# Results and Handoffs

A substantial role or Worker delegation produces three artifacts.

## Detailed Result

Write the complete work product to:

```text
.maestro/tasks/<task-id>/roles/<role>/runs/<timestamp>-result.md
```

For a capability Worker, use:

```text
.maestro/tasks/<task-id>/workers/<worker-id>/runs/<timestamp>-result.md
```

For a persisted exploratory Worker, use the corresponding
`.maestro/memory/temporary/active/<temporary-id>/workers/<worker-id>/` paths. A Session-scoped
one-off returns its result directly and does not claim a resumable state path.

Include the performed work, evidence, analysis, conclusions, risks, open questions, and relevant
Artifact paths. For a temporary direct role call, use the corresponding Temporary Memory directory.

## Current State

Update the role's or Worker's `current-state.md` using the fields in [memory.md](memory.md). It
exists so the same execution unit can resume without the earlier Agent Session. A Worker resumes
from its immutable `spec.yaml` snapshot as well as Current State.

## Lightweight Handoff

Return only what Old Zhou needs to decide the next action:

```json
{
  "status": "completed",
  "summary": "Confirmed the active call path and excluded two hypotheses.",
  "result_path": ".maestro/tasks/<task-id>/roles/laborer/runs/<timestamp>-result.md",
  "role_state_path": ".maestro/tasks/<task-id>/roles/laborer/current-state.md",
  "needs_user_input": false,
  "questions": [],
  "recommended_next": [
    { "role": "architect", "reason": "Evaluate the confirmed boundary" }
  ]
}
```

A dynamic Worker uses `worker_state_path` instead of `role_state_path`. A next-step recommendation
may identify a stable `role` or a non-empty `capabilities` list for fresh resolution, but never both.
For example:

```json
{
  "status": "completed",
  "summary": "Measured bundle and runtime costs and isolated the dominant startup module.",
  "result_path": ".maestro/tasks/<task-id>/workers/frontend-performance/runs/<timestamp>-result.md",
  "worker_state_path": ".maestro/tasks/<task-id>/workers/frontend-performance/current-state.md",
  "needs_user_input": false,
  "questions": [],
  "recommended_next": [
    {
      "capabilities": ["architecture-design", "runtime-analysis"],
      "reason": "Evaluate a boundary change using the recorded profile"
    }
  ]
}
```

When a role is blocked on the user, the Handoff carries the exact prompt Old Zhou needs:

```json
{
  "status": "blocked",
  "summary": "Two safe implementation paths remain and the choice changes initialization order.",
  "result_path": ".maestro/tasks/<task-id>/roles/architect/runs/<timestamp>-result.md",
  "role_state_path": ".maestro/tasks/<task-id>/roles/architect/current-state.md",
  "needs_user_input": true,
  "questions": [
    {
      "question": "是否允许修改启动初始化顺序？",
      "reason": "这个决定会改变后续优化方案和回归测试范围"
    }
  ],
  "recommended_next": []
}
```

`needs_user_input: true` requires `status: blocked` plus at least one concise question and its
decision context. Old Zhou may ask it directly from the Handoff and reads the Detailed Result only
when the answer requires supporting detail. `blocked` does not imply user input: a role may instead
be waiting on another dependency. When `needs_user_input` is false, omit `questions` or use an empty
array; do not carry stale questions forward.

Exactly one state path is required: `role_state_path` or `worker_state_path`. Validate
machine-produced Handoffs against [handoff.schema.json](schemas/handoff.schema.json) before
persisting them under the Task's `handoffs/` directory.

Old Zhou should not read every Detailed Result. Read it when a role is blocked, conclusions conflict,
a decision requires more detail than the structured question provides, the user asks for the
analysis, or another role needs the source.

Pass paths directly between roles instead of copying complete results through Old Zhou's context.
