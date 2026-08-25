# ADR-0001: DeepSeek Harness owns Agent execution

- Status: accepted
- Date: 2026-08-25
- Supersedes: none
- Superseded by: none

## Context

The v2 repository implemented a host-neutral Runtime, Controller, Adapter API, and host-specific experience packs. The accepted v3 scope is narrower: start with DeepSeek Harness as the only host and avoid rebuilding an Agent runtime or a DAG execution engine that DSH already provides through `workflow`, child Agents, Goals, sessions, and runtime progress.

The initial v3 design requires a durable distinction between the static Task Graph and DSH's session-owned `todo_write` state.

## Decision

Maestro v3 owns Task Graph syntax and validation, role contracts, workflow compilation, durable project artifacts, and future revision policy. DSH owns workflow execution, subagent dispatch, Goal lifecycle, sessions, cancellation, and `todo_write` progress.

The compiler emits DSH's `{ script, meta, args }` data shape. It uses one fixed JavaScript template; YAML is placed in `args` and is never concatenated into executable source. The MVP does not expose raw workflow JavaScript as a Maestro input.

## Consequences

- V3 starts without a generic Adapter, Controller Runtime, or DAG scheduler.
- The documented compatibility target is DSH `0.1.1-rc.2`; a local CLI probe establishes only presence and version, not live integration compatibility.
- DSH's Goal and `todo_write` state cannot substitute for Maestro's future durable project memory or graph revision history.
- Live Skill loading, child execution, cancellation and user-facing workflow behavior require separately recorded Harness evidence.

## Evidence

- User-approved v3 design direction in this task.
- `src/task-graph/validate.ts`
- `src/dsh/compile-workflow.ts`
- `tests/task-graph/validate.test.ts`
- `tests/dsh/compile-workflow.test.ts`
- [DeepSeek Harness Workflow reference](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/workflow)
- [DeepSeek Harness tool catalog](https://deepseek-harness.github.io/deepseek-harness/en/reference/tool-catalog)
