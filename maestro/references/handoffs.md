# Results and Handoffs

A substantial role delegation produces three artifacts.

## Detailed Result

Write the complete work product to:

```text
.maestro/tasks/<task-id>/roles/<role>/runs/<timestamp>-result.md
```

Include the performed work, evidence, analysis, conclusions, risks, open questions, and relevant
Artifact paths. For a temporary direct role call, use the corresponding Temporary Memory directory.

## Current State

Update the role's `current-state.md` using the fields in [memory.md](memory.md). It exists so the
same role can resume without the earlier Agent Session.

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

`needs_user_input: true` requires at least one concise question and its decision context. Old Zhou
may ask it directly from the Handoff and reads the Detailed Result only when the answer requires
supporting detail. When `needs_user_input` is false, omit `questions` or use an empty array; do not
carry stale questions forward.

Validate machine-produced Handoffs against [handoff.schema.json](schemas/handoff.schema.json) before
persisting them under the Task's `handoffs/` directory.

Old Zhou should not read every Detailed Result. Read it when a role is blocked, conclusions conflict,
a decision requires more detail than the structured question provides, the user asks for the
analysis, or another role needs the source.

Pass paths directly between roles instead of copying complete results through Old Zhou's context.
