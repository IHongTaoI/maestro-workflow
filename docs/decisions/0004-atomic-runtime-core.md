# ADR-0004: V3 Runtime is the atomic trust root

- Status: accepted
- Date: 2026-08-26

## Context

The MVP performed multi-file completion through ordinary sequential writes. A crash could leave a
memory entry without a completed receipt, or a completed receipt while `task.json` still claimed an
active run. Direct replacement could expose partial JSON.

## Decision

Mutable records use temporary-file, fsync and same-directory rename. Immutable records use exclusive
atomic creation. Per-task/workspace locks serialize state transitions. Prepared receipts and result
receipts are separate. A deterministic commit journal makes result recording idempotent, and
`recover-task` repairs known crash windows using only project state.

Role mutations pass through submit, permission, validation, collection and memory-commit records.
Runtime-owned paths are default-deny.

## Consequences

Prepared history is no longer overwritten. Interrupted commits can be retried or recovered without
deleting evidence. Hosts must pass P01-P07 before the Skill starts a Workflow.
