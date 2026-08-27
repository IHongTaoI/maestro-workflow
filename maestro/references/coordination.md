# Coordination

Use this reference for substantial work, role delegation, Task creation, resumption, and closure.

## Start from the user's intent

Determine whether the request is a one-off action, an exploratory discussion, a direct role call,
or formal work. Do not create `.maestro/` state for trivial requests unless the user asks to retain
the result.

For exploration worth preserving, create or update Temporary Memory. Before formal execution,
briefly state the proposed objective and ask for confirmation unless the user has already given an
unambiguous start instruction.

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
