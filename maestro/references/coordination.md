# Coordination

Use this reference for substantial work, role delegation, Task creation, resumption, and closure.

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
2. Acquire the source and target state locks and create a `preparing` transaction using the
   multi-file protocol in [storage.md](storage.md).
3. Create Task metadata with `source_temporary`, then copy or reference the relevant `current.md`
   facts and reachable source files into Task context and References. Preserve original source
   paths and revisions.
4. Validate that the Task can resume independently, set it to `active`, then mark and move the
   source Temporary to `archive/` and clear its Session binding.
5. Mark the transaction `committed`. If any step fails before the Task is active, leave the
   Temporary active and keep the partial Task non-runnable as `preparing` for recovery.

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

Give a role:

1. A bounded objective and completion condition.
2. Relevant long-term project memory.
3. The current Task context, if a formal Task exists.
4. That role's `current-state.md`, if it exists.
5. Relevant source, Evidence, Artifact, or earlier Detailed Result paths.
6. The result directory and Handoff contract.

Do not pass the complete conversation or every historical Reference.

## Resumption

Resolve the active Temporary with the rules above before resuming exploratory work. To resume a
role in a formal Task, load:

```text
Long-term Memory
+ Task context
+ role current-state
+ new delegation
```

Read historical References only when a current-state anchor points to information needed now.

## Completion

When a formal Task's agreed outcome and relevant verification are complete:

1. Ask the Memory Worker to compress final Task state and extract long-term candidates.
2. Write `completion.md` with outcome, verification, limitations, pending work, and source paths.
3. Mark the Task completed and move it to `.maestro/tasks/archive/<task-id>/`.
4. Review long-term candidates; promote only stable, sourced knowledge.
5. Return a concise delivery summary to the user.

If compression fails, preserve a `memory_pending` record and archive the completed business Task.
