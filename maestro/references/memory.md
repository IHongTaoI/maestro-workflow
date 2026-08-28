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

A persisted exploratory Worker keeps its immutable specification and short Current State inside
the selected Temporary. `current.md` should link the active Worker state needed for resumption
rather than copying its full result. When the Temporary is archived, trashed, or promoted, its
scoped Workers expire with it.

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

Long-term Memory is a maintained experience base, not a Task record archive. Never copy Temporary
or Task contents directly into it. Trace data, routine command output, discarded hypotheses,
process logs, and one-off implementation detail remain in their source layer unless a reusable,
verified claim is extracted from them.

Every current Long-term entry has a stable `entry_id`, a `memory_kind` (`fact`, `experience`,
`principle`, `decision`, `constraint`, or `other`), concise content, and reachable `source_refs`.
Expose those fields as `current_memory.long_term_entries` in every Memory Worker request. An empty
Long-term store is represented by an empty array, not by omitting the index. Stable IDs let a
candidate name the entries it compared without coupling the protocol to Markdown headings or a
host API.

Memory Worker output is only a candidate. Before promotion, Old Zhou or a strong-model reviewer must
verify that it is stable, useful beyond the current Task, and supported by reachable `source_refs`.
Record approval or rejection under `memory/long-term/decisions/`; retain rejected candidates so the
same weak claim is not repeatedly reconsidered.

### Evolution proposals

For each extracted Long-term candidate, compare its durable claim with the indexed entries and emit
one proposal under `long_term_candidates`. The proposal records a stable `candidate_id`, its
`memory_kind`, a match classification, an action, conflict status, rationale, structured source
metadata, and reachable `source_refs`.

Classify the comparison before choosing an action:

- `novel`: no entry covers the claim;
- `duplicate`: an entry already covers the same claim;
- `overlap`: existing entries should absorb or consolidate the new evidence;
- `conflict`: current evidence contradicts an entry;
- `low-value`: the material is temporary, one-off, or not reusable.

Prefer maintenance over proliferation. For a candidate that is eligible for Long-term Memory, use
this order:

```text
UPDATE → MERGE → CREATE
```

`UPDATE` targets exactly one overlapping or conflicting entry. `MERGE` targets at least two.
`CREATE` is allowed only when the claim is novel and targets none. Emit `SKIP` for a duplicate or
low-value candidate; a duplicate names the entries that already cover it, while a low-value
candidate targets none. Do not use `CREATE` to avoid comparing with an existing topic.

The `source` metadata contains `type: temporary | task`, the source ID, creation time, and an
optional host-provided `workspace_id`. It helps route and audit the proposal, but does not replace
`source_refs`; reachable source files are the authoritative evidence.

These actions are proposals, not writes. The Memory Worker cannot apply or approve them. Old Zhou
or a strong-model reviewer verifies usefulness, stability, matching targets, and provenance, may
change the proposed action, and publishes an immutable decision before any approved update uses the
mutable-state write protocol.

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

A conflict proposal uses `conflict_status: pending-confirmation` until its evidence has been
verified, or `confirmed` once the contradiction itself is verified. Both states still require
review before mutation. Non-conflict proposals use `none`. Never relabel a conflict as overlap or
novel merely to pass validation.

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

Its consolidation flow is bounded and ordered:

1. Extract reusable facts, experiences, principles, decisions, or constraints from the supplied
   source files.
2. Compare every extracted claim with `current_memory.long_term_entries` by content, applicability,
   evidence, and stable ID.
3. Classify it as novel, duplicate, overlap, conflict, or low-value.
4. Propose `UPDATE`, `MERGE`, `CREATE`, or `SKIP` using the evolution rules above.
5. Return the proposals for validation and independent review; do not mutate Long-term Memory.

Validate structured input/output against:

- [memory-worker-request.schema.json](schemas/memory-worker-request.schema.json)
- [memory-worker-response.schema.json](schemas/memory-worker-response.schema.json)

Immediately before persisting either formal artifact, run the corresponding artifact-triggered
protocol guard:

```bash
python maestro/scripts/validate.py memory-request <file> --project-root <project-root>
python maestro/scripts/validate.py memory-response <file> --project-root <project-root>
```

Persist the canonical artifact only after validation succeeds. On failure, repair and validate once
more. If the second attempt fails, retain the complete raw result with an `.invalid.json` suffix
beside the intended artifact, record the diagnostics, and continue through the existing fallback
rules; do not treat the invalid file as a Memory Worker request or response.
This validation must not create or transition a Task, Temporary, Workflow, delegation, phase, or
role invocation. It checks the artifact and its reachable project-relative file references only.
