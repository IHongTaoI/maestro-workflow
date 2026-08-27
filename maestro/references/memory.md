# Three-layer Memory

Use memory to preserve continuity, not to reproduce the conversation or execution log.

## Temporary Memory

Temporary Memory represents valuable discussion before a formal Task. Keep `current.md` short:

```markdown
---
revision: 12
updated_at: 2026-08-27T11:05:00Z
updated_by: old-zhou/session-or-run-id
---

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

### Temporary routing context

During candidate selection, load only each active Temporary's `meta.yaml` and these sections from
`current.md`: Topic, Current goal, Confirmed, and Open questions. Do not load candidate
`references/` trees, rejected-history detail, or full conversation material until after selection.

Maintain a current-Session binding after a Temporary is explicitly selected, uniquely resolved, or
created. The binding is conversational state, not a requirement for a host-specific API. When the
host exposes a stable Session identifier, `last_session_id` may persist the association; otherwise
keep it only in the current Session context. Treat persisted `last_session_id` as a recovery hint,
not an override: it establishes a binding only when exactly one active candidate claims that ID.

Replace or clear the binding when the user explicitly switches topics, the bound Temporary leaves
`active`, or a formal Task is created from it. A clear request that uniquely identifies another
active Temporary may replace the binding. Vague continuation language must not switch it.

Switching bindings changes only which context is loaded. It must not merge, archive, rename, or
otherwise modify the previous Temporary. Never combine two Temporaries automatically because their
topics appear similar.

## Task Memory

Task Memory contains public Task context plus each invoked role's or Worker's Current State. An
execution-unit state answers:

- `objective`
- `work_done`
- `key_findings`
- `important_paths`
- `open_items`
- `recommended_next`
- `history_refs`

Keep current state immediately useful for the next invocation. Move older but still valuable detail
into `references/`; do not create a Reference for routine searches, repeated output, or discarded
noise. Mutable Task and role Markdown uses the revision front matter and write protocol in
[storage.md](storage.md).

## Long-term Memory

Long-term Memory contains project knowledge likely to matter across future Tasks: architecture,
stable module responsibilities, verified facts, API boundaries, conventions, and durable decisions.

Memory Worker output is only a candidate. Before promotion, Old Zhou or a strong-model reviewer must
verify that it is stable, useful beyond the current Task, and supported by reachable `source_refs`.
Record approval or rejection under `memory/long-term/decisions/`; retain rejected candidates so the
same weak claim is not repeatedly reconsidered.

### Evidence precedence and conflicts

Resolve factual conflicts in this order:

```text
current code or runtime evidence
> current Task verified findings
> Long-term Memory
> historical References
```

Higher-priority evidence does not make lower-priority history disappear. When current evidence
contradicts a Long-term entry, stop using the old entry as current truth and create a review record
with:

- a stable entry or candidate ID and the exact claim under review;
- outcome: `approved`, `rejected`, or `superseded`;
- reachable `source_refs` for both the earlier claim and the contradicting evidence;
- reviewer, timestamp, rationale, and replacement entry ID when superseded.

After review, update Long-term `current.md` through the mutable-state write protocol. Replace the
current summary with the newly approved claim or remove the rejected claim. Publish an immutable
decision that marks the preserved candidate/entry `superseded` or `rejected` and links its
replacement when one exists. Never silently edit the old claim into new wording, delete its
sources, or continue presenting it as current while a known contradiction is unresolved.

If the contradiction has not yet been verified, label the old entry disputed in current context and
prefer the higher-priority evidence for the present decision. A Memory Worker may propose the
supersession, but Old Zhou or a strong-model reviewer must approve it.

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

The Memory Worker organizes memory. It must not select roles or Workers, make architecture
decisions, change
Task scope, or approve its own long-term candidates.

Validate structured input/output against:

- [memory-worker-request.schema.json](schemas/memory-worker-request.schema.json)
- [memory-worker-response.schema.json](schemas/memory-worker-response.schema.json)
