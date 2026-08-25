# Maestro v3 for DeepSeek Harness

Maestro v3 is a declarative software-delivery orchestration layer for DeepSeek Harness (DSH).
It owns role contracts, Task Graph validation, workflow compilation, durable project artifacts,
and revision rules. DSH owns Agent execution, child-session lifecycle, workflow execution, Goals,
and session-scoped `todo_write` progress.

This repository deliberately does **not** include an Agent Runtime, a DAG scheduler, a generic
host Adapter layer, or a Cordis dashboard.

## Development

```powershell
npm install
npm run typecheck
npm test
npm run dsh:probe
```

`dsh:probe` only runs `dsh --version`. It does not open DSH, invoke a model, or modify DSH settings.

## Project Skill and TPM smoke workflow

From this repository's root, install the bundled `maestro-workflow` Skill into DSH's
project-level discovery path, then verify its byte-identical copy:

```powershell
npm run --silent dsh:install-skill
npm run --silent dsh:verify-skill
```

The generated `.dsh/` directory is ignored by Git; the source of truth remains
[`skills/maestro-workflow`](skills/maestro-workflow). An installation refuses to overwrite a
modified project copy. Use `npm run --silent dsh:install-skill -- --force` only when intentionally
replacing that local copy.

Compile the included read-only TPM smoke graph to the exact request data accepted by DSH:

```powershell
npm run --silent dsh:compile -- --file examples/tpm-smoke.task-graph.yaml
```

This prints only JSON. It validates the YAML and produces the fixed `{ script, meta, args }`
request, but does **not** open DSH, send a model request, or create a child Agent.

For the live handoff, open a fresh DSH Web session for this project after installation. Tell the
foreground Agent that execution is explicitly approved, ask it to load `maestro-workflow`, and
instruct it to use the compiled JSON unchanged for exactly one `workflow` invocation. The expected
successful result is one `tpm` child Agent returning schema-valid `summary`, `artifacts`, and
`blockers`; no files should be created by this smoke graph. Inspect the resulting DSH trajectory
for the child completion and schema validation—only that UI run is a live Harness verification.

## Durable task workflow

For a real delivery, use a persistent task instead of the stateless smoke command:

```powershell
npm run --silent maestro -- create-task --task health-delivery --file planning/task-graph.yaml
npm run --silent maestro -- prepare-task-run --task health-delivery --memory "health retry"
```

`prepare-task-run` first records an active run below `.maestro/`, then prints the exact DSH
`{ script, meta, args }` request. It still does not start DSH or a model. Give that JSON unchanged
to one DSH `workflow` call. After the foreground session receives the aggregate workflow result,
save the returned JSON and record it locally:

```powershell
npm run --silent maestro -- record-task-run --task health-delivery --file workflow-result.json
```

The command accepts only a result whose graph name and task IDs exactly match the persisted Task
Graph. It writes an immutable run receipt, snapshots every declared project-relative regular-file
Artifact of at most 5 MiB, and derives one source-linked memory entry. A run with any non-empty
`blockers` array becomes `blocked`; otherwise it becomes `completed`. Query remembered material
without invoking DSH:

```powershell
npm run --silent maestro -- query-memory --query "health retry"
```

`.maestro/` is durable project state and is intentionally not ignored: commit task records, run
receipts, Artifact snapshots, and memory entries when they are appropriate project evidence. Do
not place secrets or unsuitable binary data in declared Artifacts. Use `revise-task` with a new
validated YAML file only after the task has no active run; it creates the next graph revision.

```text
.maestro/
  tasks/<task-id>/task.json
  tasks/<task-id>/runs/run-000001.json
  artifacts/<artifact-id>/content
  artifacts/<artifact-id>/metadata.json
  memory/<memory-id>.json
```

Memory is explicit rather than ambient. `prepare-task-run` injects bounded keyword-matched excerpts
only when given `--memory`; an empty query injects no project memory. This v3 storage is new and is
not compatible with, or derived from, the removed V2 Runtime state.

## MVP boundary

The first MVP validates a YAML Task Graph and compiles it to the `{ script, meta, args }` request
consumed by DSH's `workflow` tool. The generated script delegates execution to the Harness using
its documented workflow hooks. A graph is a static plan; `todo_write` is an ephemeral per-session
runtime checklist and is never used as the source of graph structure or durable completion state.

See [the implementation plan](docs/plans/2026-08-25-deepseek-harness-mvp.md) and
[the DSH capability baseline](docs/dsh-capability-baseline.md).
