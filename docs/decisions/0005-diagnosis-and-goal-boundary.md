# ADR-0005: Evidence-first diagnosis and DSH Goal boundary

- Status: accepted
- Date: 2026-08-26

## Context

A static delivery graph assumes the problem and acceptance boundary are already known. Bug and
performance investigations violate that assumption: traces, coverage, logs or small experiments
determine the next useful action. Freezing implementation work before collecting evidence makes the
workflow advance mechanically through a guessed solution.

Separately, a foreground DSH Agent may create a long-running Goal around Maestro. Goal rounds keep
the root Agent active while children work and can encourage it to interrupt healthy children and
take over their implementation. DSH Goals are session state and duplicate Maestro's durable
workspace lifecycle.

## Decision

Add one shared `diagnosis` mode for bugs and performance work:

1. Establish a reproducible baseline and an evidence plan.
2. Iterate through one hypothesis and minimum experiment at a time.
3. Stay in diagnosis while the report is `investigating`.
4. Advance only after the root cause, evidence and success metric are `confirmed`.
5. Freeze the implementation Task Graph after diagnosis, then reuse planning, implementation,
   testing and delivery.

The Maestro Skill does not call `create_goal` unless a user explicitly requests DSH Goal mode.
Running children place Old Zhou in a wait-only controller state; elapsed time or missing files alone
cannot authorize cancellation or controller implementation.

## Consequences

- Bug and performance templates share one lifecycle instead of duplicating the delivery system.
- Diagnostic scripts remain auditable Artifacts and do not silently become production changes.
- The Runtime provides an evidence gate, while host-only Goal and waiting behavior remains an
  explicit Skill contract because DSH owns those tools.
- Existing Lite, Plan and Workflow stage sequences remain unchanged.
