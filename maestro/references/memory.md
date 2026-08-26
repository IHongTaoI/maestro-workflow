# Three-layer Memory

Use memory to preserve continuity, not to reproduce the conversation or execution log.

## Temporary Memory

Temporary Memory represents valuable discussion before a formal Task. Keep `current.md` short:

```markdown
# Topic

## Current goal
...

## Confirmed
- ...

## Rejected
- ... — reason and source

## Open questions
- ...

## History references
- references/<name>.md
```

On an explicit Session Handoff, compress the current discussion into this format. Archive it when
the discussion has lasting value but is paused; move it to Trash only when the user has rejected it
and it has no continuing value.

## Task Memory

Task Memory contains public Task context plus each invoked role's Current State. A role state answers:

- `objective`
- `work_done`
- `key_findings`
- `important_paths`
- `open_items`
- `recommended_next`
- `history_refs`

Keep current state immediately useful for the next invocation. Move older but still valuable detail
into `references/`; do not create a Reference for routine searches, repeated output, or discarded
noise.

## Long-term Memory

Long-term Memory contains project knowledge likely to matter across future Tasks: architecture,
stable module responsibilities, verified facts, API boundaries, conventions, and durable decisions.

Memory Worker output is only a candidate. Before promotion, Old Zhou or a strong-model reviewer must
verify that it is stable, useful beyond the current Task, and supported by reachable `source_refs`.
Record approval or rejection under `memory/long-term/decisions/`; retain rejected candidates so the
same weak claim is not repeatedly reconsidered.

## Current + References

Load `current.md` or `current-state.md` by default. References are historical anchors and are loaded
only when required for a current decision, conflict, explanation, or user request. Never inject the
entire Reference tree automatically.

## Memory Worker

Trigger only at these boundaries:

1. A role completes a substantial delegation.
2. The user confirms a Session Handoff.
3. A formal Task is created from Temporary Memory.
4. A Task completes or is archived.

Use the configured memory model when the host supports model selection. Retry it once after a
transient or invalid-output failure, then fall back to the primary model. If no suitable runner is
available, the current agent may perform the same bounded compression. If all attempts fail, write
the complete request and sources under `memory/pending/` and continue the business task.

The Memory Worker organizes memory. It must not select roles, make architecture decisions, change
Task scope, or approve its own long-term candidates.

Validate structured input/output against:

- [memory-worker-request.schema.json](schemas/memory-worker-request.schema.json)
- [memory-worker-response.schema.json](schemas/memory-worker-response.schema.json)
