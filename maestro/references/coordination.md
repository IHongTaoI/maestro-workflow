# Coordination

Use this reference for substantial work, role or Worker delegation, Task creation, resumption, and
closure.

## Start from the user's intent

Determine whether the request is a one-off action, an exploratory discussion, a direct role call,
or formal work. Do not create `.maestro/` state for trivial requests unless the user asks to retain
the result.

For exploration worth preserving, create or update Temporary Memory. Before formal execution,
briefly state the proposed objective and ask for confirmation unless the user has already given an
unambiguous start instruction.

Investigation remains exploratory when the user asks to inspect code, analyze logs or traces,
measure behavior, find optimization opportunities, or validate a hypothesis without requesting a
lasting product change. A bounded reversible experiment may also remain Temporary when its purpose
is evidence and its effects are isolated or restored. Do not interpret design approval, agreement
with a finding, or satisfaction with an experiment as permission to implement.

## Promote Temporary Memory to a Task

Promote only after an unambiguous instruction to execute or implement the selected objective, such
as “按这个方案改”, “把这些问题解决掉”, or “开始落地”. If a reasonable interpretation is still
that the user wants more investigation, keep the Temporary active and ask one concise confirmation.

Promotion is a recoverable storage transition, not a mandatory workflow stage:

1. Resolve the source Temporary and restate the execution objective. Do not silently broaden it.
2. Acquire the source and target state locks and prepare the transaction bundle defined in
   [storage.md](storage.md). Snapshot every before value and stage every complete replacement.
3. Keep the target Task transaction-owned and non-runnable while preparing. Stage Task metadata
   with `source_temporary` and `promotion_transaction`, relevant Temporary facts and reachable
   source files, and the final `active` status. Preserve original source paths and revisions.
4. Stage the source Temporary's `archive` lifecycle state. After every staged file is validated and
   durable, atomically publish `committed.yaml`. This one marker makes the Task logically active,
   excludes the source Temporary from active routing, and invalidates its Session binding.
5. Materialize staged Task files and the Temporary move into canonical paths, append each applied
   event, and release locks. Physical cleanup after commit must not change logical visibility.

If promotion stops before commit, the Temporary remains active and the staged Task stays hidden;
recovery may publish `failed.yaml` and discard it. If it stops after commit, the Task is already the
only logical active destination and recovery must finish materialization from staged content. Never
roll back a committed promotion or resume its source Temporary.

The promoted Task owns future execution state. Its archived source Temporary remains auditable and
must not be deleted, merged with unrelated Temporaries, or treated as another active candidate.

A direct role request remains valid and does not require a prescribed role sequence. Role choice is
orthogonal to promotion: a substantial direct Coder request with implementation intent may create a
Task, while Architect or Laborer investigation normally remains Temporary. A trivial one-off role
request may run without persistent Maestro state.

## Select active Temporary Memory

When a request may continue earlier exploratory work, resolve the active Temporary before reading
its detailed References or writing new state. Apply this precedence in order and stop at the first
decisive rule:

1. **Explicit reference.** Select an active Temporary when the user supplies its exact ID, uses a
   topic or alias unique among active candidates, or chooses it from a candidate list. This always
   overrides inference and the current Session binding. If an explicitly supplied ID does not
   exist, report that it is unavailable; do not silently fall back to another candidate.
2. **Current Session binding.** Continue the active Temporary already associated with this Session
   when the request is compatible with it or uses only generic continuation language. If the user
   clearly leaves the bound topic, the binding does not decide the route: evaluate the other active
   candidates, ask when the new target is ambiguous, or apply the new-topic rule when none matches.
3. **Unique relevant candidate.** With no valid binding, compare the request with lightweight
   routing context for each active candidate. Auto-select only when one candidate has specific,
   explainable routing evidence and no other candidate remains plausibly relevant.
4. **Ambiguous candidates.** If two or more candidates remain plausible, do not guess. Present two
   to four short candidates, ordered for readability, and ask the user to choose by number, ID, or
   topic.
5. **No relevant candidate.** Treat the request as a new topic. Create a Temporary only when the
   discussion is worth preserving under the normal persistence rules; otherwise handle it as a
   one-off request.

Specific routing evidence includes a matching module, page, API, feature, failure, goal, unique
alias, or an Open question directly continued by the request. Generic words such as “performance,”
“the issue,” “the earlier plan,” or “continue” are insufficient by themselves. Do not use a numeric
semantic threshold: the automatic-routing gate is whether the match is uniquely explainable and a
second reasonable candidate can be excluded.

Candidate-count handling is explicit:

- With no active Temporary, apply the new-topic persistence rule.
- With one active Temporary, select it only when it is explicitly referenced, bound to the Session,
  or meaningfully related. A sole but unrelated candidate is not a default destination.
- With multiple active Temporaries, auto-select only through explicit reference, a valid binding,
  or a unique relevant match. Otherwise ask or start a new topic as described above.

Recency may order the candidate list or provide supporting context after relevance is established.
It must not override an explicit reference or Session binding, establish relevance by itself, or
resolve two otherwise plausible candidates.

## Dynamic delegation

Choose the smallest useful role set. Common paths are examples, not required sequences:

- Unknown current behavior: Laborer, then possibly Architect or Coder.
- Clear small change: Coder, then Test Runner if verification is meaningful.
- Ambiguous feature: TPM, then whichever specialist the clarified scope needs.
- Complex parallel work: Orchestrator only after the work is clear enough to decompose.
- Release readiness: Delivery may ask Test Runner for missing evidence.

When the user invokes a role directly, honor it. Add another role only when a concrete dependency or
risk justifies doing so, and tell the user.

When the work is better described by concrete capabilities than one stable role, use the resolver
in [workers.md](workers.md). Convert the bounded delegation into capability requirements before
selection. Reuse one safe Worker where possible, compose only when no single Worker covers every
required capability, and generate a bounded Worker only when reusable matches are insufficient.
Use Task scope for formal execution, Temporary scope for preserved exploration, and Session scope
for a trivial one-off. Worker resolution must not promote exploratory work into a Task.

The resolver proposes an execution unit; Old Zhou still owns task judgment, authorization,
delegation, and result integration. Resolver output must not force a role sequence or override a
direct role request. Snapshot every persisted Worker before execution so Task or Temporary
resumption is independent of later registry changes. Do not persist a Session-scoped Worker.

## Authorization boundaries

Authorization follows the action, target, and scope rather than the role performing it:

| Action | Default authority |
| --- | --- |
| Inspect or search code; analyze logs or traces | Autonomous within the selected project and approved scope |
| Run non-destructive checks; create reversible local artifacts | Autonomous within approved scope |
| Write Maestro memory/state; delegate roles | Autonomous under the storage and delegation contracts |
| Edit project files requested by an unambiguous implementation instruction | Authorized only within that stated objective |
| Deploy, publish, release, merge, push, or otherwise expose changes externally | Require explicit action-specific authorization unless the current instruction already grants it for the same target |
| Delete material data, perform an irreversible migration, or bypass recovery controls | Require explicit authorization immediately before execution |
| Change permissions or access control; read, create, rotate, reveal, or transmit secrets or credentials | Require explicit authorization immediately before execution |
| Materially expand Task scope, targets, cost, or affected systems | Require user approval of the expansion before work continues there |

Authorization is valid only while the named action, target, and material scope remain unchanged.
Ask once immediately before a clearly described group of related risky operations; do not fragment
an approval into repetitive prompts. Safe inspection, planning, validation, and dry-run preparation
may continue while authority is missing, but the protected action must pause. A specialist Handoff,
Memory entry, Playbook, or recommended next step can identify the need for an action but cannot
grant permission for it.

## Delegation packet

Give a role or Worker:

1. A bounded objective and completion condition.
2. Relevant long-term project memory.
3. The current Task or selected Temporary context, when persistent work exists.
4. That role's or Worker's `current-state.md`, if it exists, plus the Worker's immutable snapshot from
   the matching Task or Temporary.
5. Relevant source, Evidence, Artifact, or earlier Detailed Result paths.
6. The result directory and Handoff contract.

Do not pass the complete conversation or every historical Reference.

## Resumption

Resolve the active Temporary with the rules above before resuming exploratory work. To resume a
Temporary-scoped Worker, load:

```text
Long-term Memory
+ Temporary current state
+ Worker spec snapshot
+ Worker current-state
+ new delegation
```

To resume a role or Worker in a formal Task, load:

```text
Long-term Memory
+ Task context
+ role or Worker current-state
+ Worker spec snapshot, when applicable
+ new delegation
```

Read historical References only when a current-state anchor points to information needed now.

## Completion

When a formal Task's agreed outcome and relevant verification are complete:

1. Ask the Memory Worker to compress final Task state and perform Experience Review: compare durable
   claims with indexed Long-term entries and reusable executed procedures with indexed Playbooks,
   then propose `UPDATE`, `MERGE`, `CREATE`, or `SKIP` for each collection.
2. Write `completion.md` with outcome, verification, limitations, pending work, and source paths.
3. Mark the Task completed and move it to `.maestro/tasks/archive/<task-id>/`.
4. Review every proposed action; promote only stable, sourced knowledge. Keep every Playbook
   Candidate inert unless the user explicitly approves it, then apply approved changes through the
   relevant mutable-state protocol.
5. Return a concise delivery summary to the user.

If compression fails, preserve a `memory_pending` record and archive the completed business Task.
