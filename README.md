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

## MVP boundary

The first MVP validates a YAML Task Graph and compiles it to the `{ script, meta, args }` request
consumed by DSH's `workflow` tool. The generated script delegates execution to the Harness using
its documented workflow hooks. A graph is a static plan; `todo_write` is an ephemeral per-session
runtime checklist and is never used as the source of graph structure or durable completion state.

See [the implementation plan](docs/plans/2026-08-25-deepseek-harness-mvp.md) and
[the DSH capability baseline](docs/dsh-capability-baseline.md).
