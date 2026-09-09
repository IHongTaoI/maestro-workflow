# Results and Handoffs

A substantial Worker delegation produces three artifacts. Old Zhou consumes these artifacts,
judges the evidence, and tells the user only what they need for the next decision.

## Detailed Result

Write the complete work product to:

```text
.maestro/tasks/<task-id>/workers/<worker-id>/runs/<timestamp>-result.md
```

For a persisted exploratory Worker, use the corresponding
`.maestro/memory/temporary/active/<temporary-id>/workers/<worker-id>/` paths. A Session-scoped
one-off returns its result directly and does not claim a resumable state path.

Include the performed work, evidence, analysis, conclusions, risks, open questions, and relevant
Artifact paths. This is the technical record; do not copy it into the normal user-facing update.

## Current State

Update the Worker's `current-state.md` using the fields in [memory.md](memory.md). It exists so the
same execution unit can resume without the earlier Agent Session. A Worker resumes from its
immutable `spec.yaml` snapshot as well as Current State.

## Lightweight Handoff

Return only what Old Zhou needs to judge the result and decide the next action:

```json
{
  "status": "completed",
  "summary": "Measured startup cost and isolated the dominant module.",
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

A next-step recommendation uses a non-empty `capabilities` list for fresh resolution. It never
selects or grants authority to the next Worker.

When a Worker is blocked on the user, the Handoff carries the exact prompt Old Zhou needs:

```json
{
  "status": "blocked",
  "summary": "Two safe implementation paths remain and the choice changes initialization order.",
  "result_path": ".maestro/tasks/<task-id>/workers/startup-design/runs/<timestamp>-result.md",
  "worker_state_path": ".maestro/tasks/<task-id>/workers/startup-design/current-state.md",
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
when the answer requires supporting detail. `blocked` does not imply user input: a Worker may
instead be waiting on another dependency. When `needs_user_input` is false, omit `questions` or
use an empty array; do not carry stale questions forward.

For new work, exactly one `worker_state_path` is required. The schema continues to accept
`role_state_path` and a recommended `role` only for historical records. When resuming one, keep
the original path and role instruction digest; any new follow-up is resolved by capabilities.

The validator is an artifact-triggered protocol guard, not a Workflow trigger. Immediately before
persisting a machine-produced Handoff, run:

```bash
python maestro/scripts/validate.py handoff <file> --project-root <project-root>
```

Persist the canonical Handoff only when validation succeeds. After a validation failure, repair the
artifact once and validate it again. If it still fails, preserve the complete raw result with an
`.invalid.json` suffix beside the intended artifact and record the validation diagnostics; never
silently accept it as a Handoff. Validation must not create a Task or Temporary, start a Workflow,
delegate work, invoke a fixed role, or cause a phase transition.

The CLI enforces [handoff.schema.json](schemas/handoff.schema.json), portable project-relative
paths, and reachable result and state files. Task-scoped Handoffs live under
`.maestro/tasks/<task-id>/handoffs/`; persisted Temporary-scoped Handoffs live under
`.maestro/memory/temporary/active/<temporary-id>/handoffs/`. Session-scoped work does not persist a
Handoff.

Old Zhou should not read every Detailed Result. Read it when a Worker is blocked, conclusions
conflict, a decision requires more detail than the structured question provides, the user asks for
the analysis, or another Worker needs the source.

Pass paths directly between Workers instead of copying complete results through Old Zhou's context.

## User-facing result

Old Zhou leads with the conclusion and includes only applicable items:

- the result;
- verification or the evidence path;
- uncertainty, limitation, or blocker;
- a decision needed from the user or the recommended next step.

Do not expose routine code-search steps, commands, internal IDs, capability routing, or the full
Detailed Result unless the user asks.
