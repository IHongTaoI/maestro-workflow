# DeepSeek Harness Capability Baseline

## Compatibility target

Maestro v3 currently targets `@deepseek-ai/dsh` `0.1.1-rc.2`. The version is pinned as a compatibility target, not an assertion that every DSH composition exposes every optional tool.

## Verified design contracts

- DSH `workflow` accepts plain data `{ script, meta, args }`; it owns the live run, child-session lifecycle, cancellation and cleanup.
- The script receives `agent`, `parallel`, `pipeline`, `phase`, `log`, and `args`. `phase` is progress vocabulary, not dependency scheduling.
- `todo_write` is session-owned runtime progress. It is distinct from the static Maestro Task Graph.
- `create_goal` persists a same-session goal and is root-authorized. It is not Maestro's durable project memory.

Maestro therefore validates graph dependencies before compilation and emits a fixed script template. YAML descriptions and other user content are carried as JSON `args`, never inserted into executable source.

## Project integration boundary

`npm run --silent dsh:install-skill` copies the versioned repository Skill to
`<project>/.dsh/skills/maestro-workflow`; `dsh:verify-skill` compares all installed files against
that source copy. The installation and verification commands are local file operations only.
`dsh:compile` parses, validates, and prints a fixed workflow request only. Neither command starts
DSH, invokes `workflow`, sends a model request, or creates a child Agent.

Consequently, the remaining live boundary is deliberate and manual: a DSH foreground session must
discover the project Skill and call its `workflow` tool with the compiled request. A successful
compile or installation is not evidence of a live workflow run.

## Durable task-memory boundary

The V3 task commands own project persistence under `.maestro/`, while DSH continues to own every
live Workflow, child-Agent, cancellation and session action:

1. `create-task` persists a validated version-one Task Graph.
2. `prepare-task-run` persists one active run and prints a fixed DSH request with an optional,
   bounded task-memory context in JSON `args`.
3. A person or foreground DSH Agent makes the one `workflow` call.
4. `record-task-run` validates the returned aggregate result, snapshots declared in-project files,
   writes an immutable receipt, and derives a source-linked memory entry.

The CLI never starts DSH or a model. It rejects an active-task revision, result task IDs that differ
from the stored Graph, non-regular/missing/outside-project Artifacts, and individual Artifact files
larger than 5 MiB. Project-memory retrieval is deterministic keyword matching and occurs only when
the preparation caller supplies a query; no DSH Goal, `todo_write`, or ambient chat history is used
as project memory.

## Required manual verification

The automated suite does not invoke a model or start DSH. Before claiming a live integration, manually verify in the selected DSH version:

1. The `maestro-workflow` Skill is discoverable in the intended installation scope.
2. The current session can run `workflow` with the compiled request.
3. A TPM child Agent returns a schema-valid result and the parent receives the completed workflow result.
4. `todo_write` renders runtime progress without changing Task Graph semantics.
5. Cancellation and an interrupted child leave a truthful DSH workflow result.
6. A persisted task can be prepared, executed through DSH, recorded, then inspected or revised from
   a new DSH session without relying on the prior session transcript.

Run `npm run dsh:probe` for a read-only local CLI diagnostic. `unavailable` means only that `dsh` is not on `PATH`; it is not a failing test and does not modify DSH.
