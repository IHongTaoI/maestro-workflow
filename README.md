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

## MVP boundary

The first MVP validates a YAML Task Graph and compiles it to the `{ script, meta, args }` request
consumed by DSH's `workflow` tool. The generated script delegates execution to the Harness using
its documented workflow hooks. A graph is a static plan; `todo_write` is an ephemeral per-session
runtime checklist and is never used as the source of graph structure or durable completion state.

See [the implementation plan](docs/plans/2026-08-25-deepseek-harness-mvp.md) and
[the DSH capability baseline](docs/dsh-capability-baseline.md).
