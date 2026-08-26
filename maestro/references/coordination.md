# Coordination

Use this reference for substantial work, role delegation, Task creation, resumption, and closure.

## Start from the user's intent

Determine whether the request is a one-off action, an exploratory discussion, a direct role call,
or formal work. Do not create `.maestro/` state for trivial requests unless the user asks to retain
the result.

For exploration worth preserving, create or update Temporary Memory. Before formal execution,
briefly state the proposed objective and ask for confirmation unless the user has already given an
unambiguous start instruction.

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

To resume a role, load:

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
