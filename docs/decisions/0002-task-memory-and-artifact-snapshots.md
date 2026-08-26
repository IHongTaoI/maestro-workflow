# ADR-0002: V3 task memory uses project-owned immutable run receipts

- Status: accepted
- Date: 2026-08-25
- Supersedes: none
- Superseded by: none

## Context

The initial DSH MVP can validate and compile a Task Graph, but its results exist only in one DSH
Workflow invocation. DSH Goals and `todo_write` are session state and cannot recover a Maestro
task after the session ends. The user approved a new V3 persistence model rather than importing the
removed V2 Runtime or its data format.

## Decision

V3 stores project-owned state under `.maestro/`. A task has a validated, versioned Task Graph and
at most one active run. Preparing a run persists its `running` state and exact compiled DSH request
before returning it. Recording a DSH result writes a separate immutable result receipt, snapshots every declared
regular-file Artifact inside `.maestro/artifacts/`, and derives a source-linked project-memory entry.

Task data, prepared/result receipts, Artifact metadata and memory entries are intended to be committed to Git.
They are portable JSON/Markdown and never contain an absolute project path. Cache and lock files,
if introduced later, must be ignored separately.

Project-memory retrieval is explicit. It uses deterministic scoped matching over stored entry text
and tags, then injects bounded per-role excerpts into the compiled workflow `args`. V3 does not
introduce a vector database, remote service, or DSH execution transport.

## Consequences

- A DSH workflow request can be resumed verbatim from local task records rather than an opaque
  session transcript. If the operator cannot determine whether the request was already invoked,
  they must not invoke it again.
- Artifact history is reproducible up to a bounded snapshot size; paths outside the project and
  missing or non-file artifacts are rejected.
- `prepare-task-run` and `record-task-run` remain local commands. A person or DSH foreground Agent
  still makes the actual `workflow` call.
- Task Graph revision is explicit and prohibited while a run is active.

## Evidence

- User-approved V3 storage contract in this task.
- [DSH ownership boundary](0001-dsh-owns-agent-execution.md)
- `src/dsh/compile-workflow.ts`
