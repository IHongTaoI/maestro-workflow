# Maestro V3 for DeepSeek Harness

Maestro V3 is a project-owned, recoverable software-delivery workflow for DeepSeek Harness (DSH).
Maestro owns lifecycle gates, role contracts, Task Graph validation, durable state, permissions,
memory and delivery evidence. DSH owns child-Agent execution and the live `workflow` call.

## Install and verify

The package now exposes a real `maestro` executable. Install the package in the target project,
then initialize the DSH adapter; copying the Skill alone is not a complete installation.

```powershell
npm install --save-dev @maestro/v3-dsh
npx --no-install maestro init --host dsh
npx --no-install maestro verify-host
npx --no-install maestro probe-host
```

`probe-host` runs P01-P07 and fails closed: atomic state writes, exclusive locking, memory IO,
protected-path denial, role assets, the DSH executable contract and workspace-only recovery.

For repository development:

```powershell
npm install
npm run typecheck
npm test
```

## Work modes and lifecycle

Old Zhou selects a mode with the user, then creates a workspace below
`.agents/.local/work/<workspace-id>/`.

| Mode | Stages |
|---|---|
| Lite | intake → implementation → testing → delivery |
| Plan | intake → planning → implementation → testing → delivery |
| Workflow | intake → requirements → design → architecture → planning → implementation → testing → delivery |

```powershell
npx --no-install maestro create-workspace --workspace 202608260900-health --mode workflow --identity "Health endpoint" --file request.md
npx --no-install maestro advance-workspace --workspace 202608260900-health
npx --no-install maestro revise-workspace --workspace 202608260900-health --severity major --stage design --reason "API boundary changed"
```

Every stage transition validates required artifacts and creates an immutable checkpoint. Revision
severity is explicit: Minor, Major or Critical. Testing advances only when
`testing/test-report.md` contains `status: passed`; delivery completes only with
`delivery/report.md` containing `status: accepted`.

## Task Graph and execution

The architecture stage freezes `planning/task-graph.yaml`. Tasks declare dependencies, acceptance
criteria, intended write sets and at most three attempts. The compiler never places overlapping
write sets in the same parallel layer.

```yaml
name: health-delivery
tasks:
  - id: implement-api
    role: coder
    description: Implement the approved endpoint.
    writes: [src/api]
    maxAttempts: 3
    acceptance:
      - Unit tests pass.
```

```powershell
npx --no-install maestro compile-task-graph --file planning/task-graph.yaml
npx --no-install maestro compile-execution --file planning/task-graph.yaml
npx --no-install maestro create-task --task health-delivery --file planning/task-graph.yaml
npx --no-install maestro prepare-task-run --task health-delivery --memory "health api"
```

`prepare-task-run` persists an immutable prepared receipt before returning the exact
`{ script, meta, args }` for one DSH `workflow` call. `record-task-run` stores a separate,
immutable result receipt. Commits are idempotent and can be repaired without a session:

```powershell
npx --no-install maestro resume-task-run --task health-delivery
npx --no-install maestro recover-task --task health-delivery
npx --no-install maestro record-task-run --task health-delivery --file workflow-result.json
```

## Core protocol and permissions

Role effects use five guarded actions:

```text
submit_proposal → apply_permissions → validate_proposal → collect_result → commit_memory
```

Permissions default to deny. Roles cannot receive write or execute grants for protected workspace
metadata, events, the original request, memory, or Runtime records. Result Artifacts must have been
declared by an approved proposal and are hashed during collection.

## Three memory layers

1. Temporary drafts hold unconfirmed discussion. Confirmation or discard is explicit.
2. Task memory holds immutable runs, Artifact evidence and per-role `current-state.md` plus history.
3. Project LLM Wiki holds promoted, versioned knowledge linked to source Memory IDs.

Explicit queries are bounded. During run preparation, Wiki excerpts and task memory are selected
per role; the same ambient context is not broadcast to every Agent. `memory/current-summary.md`
contains the compact goal, decisions, constraints, frozen versions, open questions, coverage
cursor and source hash.

## V3 roles

The DSH Skill ships Old Zhou plus TPM, Laborer, Architect, Orchestrator, Coder, Test Designer,
Test Runner and Delivery. Legacy `planner` and `tester` role names remain accepted for old graphs.
Roles can return `needsUserInput`, `needsDelegation` and a bounded `roleState`.

See [the implementation contract](docs/maestro-v3-implementation.md), the
[DSH ownership decision](docs/decisions/0001-dsh-owns-agent-execution.md), and the
[three-layer memory decision](docs/decisions/0003-three-layer-memory.md).
