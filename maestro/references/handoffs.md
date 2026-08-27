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
  "recommended_next": [
    { "role": "architect", "reason": "Evaluate the confirmed boundary" }
  ]
}
```

Validate machine-produced Handoffs against [handoff.schema.json](schemas/handoff.schema.json) before
persisting them under the Task's `handoffs/` directory.

Old Zhou should not read every Detailed Result. Read it when a role is blocked, conclusions conflict,
a decision requires detail, the user asks for the analysis, or another role needs the source.

Pass paths directly between roles instead of copying complete results through Old Zhou's context.
