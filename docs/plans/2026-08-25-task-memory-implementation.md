# V3 Task Memory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add durable task state, immutable DSH run receipts, Artifact snapshots, and explicit project-memory retrieval to Maestro v3.

**Architecture:** `src/task-memory/` owns project-local JSON records under `.maestro/`; it never invokes DSH. The existing compiler accepts an optional persisted execution context and places it in `args`. The CLI prepares a run before returning its exact DSH request, then records a user/foreground-Agent supplied DSH result afterward.

**Tech Stack:** Node.js 22+, TypeScript ESM, `node:fs/promises`, `node:crypto`, `node:test`, `tsx`, and `yaml`.

---

### Task 1: Define persistent contracts and safe paths

**Files:**

- Create: `src/task-memory/contracts.ts`
- Create: `src/task-memory/paths.ts`
- Test: `tests/task-memory/paths.test.ts`

1. Write failing tests for valid task IDs, fixed `.maestro` paths, and rejection of invalid IDs.
2. Define `StoredTask`, `TaskRun`, `ArtifactRecord`, `MemoryEntry`, statuses and schema version.
3. Implement fixed derived paths below the resolved project root; do not accept a caller-supplied storage path.
4. Run `npm test -- --test-name-pattern "task memory paths"` and `npm run typecheck`.
5. Commit: `feat: define v3 task memory contracts`.

### Task 2: Create, load and revise versioned tasks

**Files:**

- Create: `src/task-memory/task-store.ts`
- Test: `tests/task-memory/task-store.test.ts`

1. Write failing temporary-project tests for task creation, duplicate rejection, persisted Graph digest, and revision rejection during an active run.
2. Implement validated task creation and loading; serialize only portable data.
3. Implement graph revision with a monotonic revision counter and no active run.
4. Run the focused tests and commit: `feat: persist versioned task graphs`.

### Task 3: Prepare a DSH run with bounded memory context

**Files:**

- Modify: `src/dsh/workflow-contract.ts`
- Modify: `src/dsh/compile-workflow.ts`
- Create: `src/task-memory/memory-store.ts`
- Modify: `src/task-memory/task-store.ts`
- Tests: `tests/dsh/compile-workflow.test.ts`, `tests/task-memory/task-store.test.ts`

1. Write failing tests proving execution context remains JSON args and is never interpolated into the fixed script.
2. Define a bounded task context containing task ID, revision, run ID, and selected memory excerpts.
3. Implement deterministic keyword retrieval; an empty query returns no project-memory entries.
4. Implement `prepareTaskRun`: reject an active task, persist `running` plus `run-000001`, and return only the compiled request.
5. Run focused tests and commit: `feat: prepare persisted dsh task runs`.

### Task 4: Record immutable results and snapshot artifacts

**Files:**

- Create: `src/task-memory/record-run.ts`
- Test: `tests/task-memory/record-run.test.ts`

1. Write failing tests for a schema-valid completed result, a blocked result, duplicate recording, missing Artifact, outside-root Artifact, and snapshot hash/contents.
2. Validate the aggregate DSH result has exactly the Task Graph task IDs and valid `summary`, `artifacts`, `blockers` structures.
3. Copy declared relative regular-file Artifacts of at most 5 MiB into immutable `.maestro/artifacts/<id>/content` snapshots with metadata and SHA-256.
4. Write the immutable receipt, derive a linked memory entry, clear active run, and set task status from blockers.
5. Run focused tests and commit: `feat: record dsh runs and artifact snapshots`.

### Task 5: Add task-memory CLI commands and Skill handoff

**Files:**

- Modify: `src/cli.ts`
- Modify: `tests/cli.test.ts`
- Modify: `skills/maestro-workflow/SKILL.md`

1. Write failing CLI tests for `create-task`, `prepare-task-run`, `record-task-run`, `revise-task`, and `query-memory` structured output.
2. Add exact commands with `--project` defaulting to the current directory; local commands never launch DSH.
3. Update Lao Zhou: after explicit user approval, create/prepare a persisted task, pass the printed JSON unchanged to DSH `workflow`, then record the returned result.
4. Run focused CLI/asset tests and commit: `feat: add durable task workflow commands`.

### Task 6: Document, verify and reconcile the MVP boundary

**Files:**

- Modify: `README.md`
- Modify: `docs/dsh-capability-baseline.md`
- Test: all test files

1. Document the `.maestro` layout, Git policy, manual DSH handoff, resume boundary, Artifact snapshot limit, and current unverified live paths.
2. Replace claims that durable Artifact/revision support is merely future scope.
3. Run `npm run typecheck`, `npm test`, `npm run dsh:probe`, CLI create/prepare/record against a temporary project, and `git diff --check`.
4. Commit: `docs: document v3 task memory workflow`.
