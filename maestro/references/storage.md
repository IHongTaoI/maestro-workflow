# Project Storage

Maestro state belongs to the target project, never the installed Skill.

## Minimal layout

Create directories lazily as the current work needs them:

```text
.maestro/
  config.yaml
  locks/
  transactions/
  memory/
    temporary/
      active/<temporary-id>/
        meta.yaml
        current.md
        references/
        worker-selections/
        workers/<worker-id>/
          spec.yaml
          current-state.md
          references/
          runs/
      archive/
      trash/
    pending/
    long-term/
      current.md
      candidates/
        pending/
        approved/
        rejected/
      decisions/
  tasks/
    <task-id>/
      task.yaml
      context.md
      decisions.md
      progress.md
      evidence/
      artifacts/
      handoffs/
      worker-selections/
      roles/<role>/
        current-state.md
        references/
        runs/
      workers/<worker-id>/
        spec.yaml
        current-state.md
        references/
        runs/
    archive/
  workers/
    registry.yaml
  playbooks/
```

The `playbooks/` directory may be supplied by the project before Maestro is first used.

The built-in Worker registry is immutable installed reference data. A project registry is created
only when reusable project-specific Workers or capability aliases are needed. Selected Worker
specifications are copied into the Task and never resolved by reference during execution.

A minimal parsed project registry has this shape:

```yaml
schema_version: 1
id: project-workers
source: project
revision: 0
updated_at: 2026-08-27T14:25:00Z
updated_by: old-zhou/session-or-run-id
aliases: {}
workers: []
```

Each reusable Worker is a complete specification from [workers.md](workers.md). A reviewed Worker
promoted from historical Task evidence uses `source: learned`; it remains an ordinary registry
entry and receives no extra authority. Validate parsed registries against
[worker-registry.schema.json](schemas/worker-registry.schema.json).

## Configuration

Use a small `config.yaml`:

```yaml
schema_version: 1
models:
  primary: null
  memory: null
```

Do not invent fine-grained per-role model settings in v1. A null memory model means use the host's
available model or perform the compression in the current agent.

## Temporary routing metadata

Each active Temporary's `meta.yaml` contains the smallest host-independent routing contract:

```yaml
id: 20260827T103000Z-a1b2c3
topic: home startup performance
status: active
created_at: 2026-08-27T10:30:00Z
updated_at: 2026-08-27T11:05:00Z
updated_by: old-zhou/session-or-run-id
revision: 12
aliases:
  - 首页启动性能
  - 首屏启动慢
last_session_id: optional-stable-host-session-id
```

Required fields are `id`, `topic`, `status`, `created_at`, `updated_at`, `updated_by`, and
`revision`. The `id` must match the Temporary directory name, and `status` must agree with its
lifecycle location. `revision` is a non-negative integer incremented by the mutable-state write
protocol below. `aliases` is an optional list of user-facing names that identify the same topic.
`last_session_id` is optional and must be omitted when the host does not expose a stable,
non-sensitive Session identifier. It is a recovery hint rather than authoritative routing state;
if several candidates contain the same ID, the normal ambiguity rules still apply.

Do not add embeddings, model scores, or host-specific routing objects to this metadata. Routing may
interpret `topic`, `aliases`, and `current.md`, but confidence is a decision made for the current
request rather than persistent truth.

Validate parsed Temporary metadata against
[temporary-meta.schema.json](schemas/temporary-meta.schema.json).

## Task metadata

Each `task.yaml` contains only execution, recovery, lifecycle, and conflict-control fields:

```yaml
id: 20260827T120000Z-d4e5f6
objective: Reduce homepage startup time without changing visible behavior
status: active
created_at: 2026-08-27T12:00:00Z
updated_at: 2026-08-27T12:03:00Z
updated_by: old-zhou/session-or-run-id
revision: 1
source_temporary: 20260827T103000Z-a1b2c3
promotion_transaction: 20260827T120000Z-p7q8r9
```

`source_temporary` is present only when the Task was promoted from Temporary Memory. A Task created
directly from an explicit execution request omits it. A promoted Task also records
`promotion_transaction`, which identifies the transaction whose commit marker controls its initial
visibility. Validate parsed Task metadata against [task.schema.json](schemas/task.schema.json).

## Mutable-state write protocol

Mutable state includes Temporary `meta.yaml` and `current.md`, Task `task.yaml`, `context.md`,
`decisions.md`, and `progress.md`, role or Worker `current-state.md`, project Worker
`registry.yaml`, and Long-term `current.md`. Each listed
mutable YAML file carries `revision`, `updated_at`, and `updated_by`. Each listed mutable Markdown
file carries the same fields in YAML front matter. New state starts at revision `0`; each successful
replacement increments exactly once. Handoffs, Detailed Results, source
References, Evidence, decision records, Worker selections under a Task or Temporary's
`worker-selections/`, and transaction events are immutable once published; add a new linked record
instead of replacing them.

Worker `spec.yaml` files under a Task or Temporary are immutable snapshots. Publish each complete
validated snapshot atomically before its first run. A project registry update cannot replace a
snapshot, and resumption must not substitute a current registry entry for a missing snapshot.
Session-scoped Workers are not project state and leave no snapshot.

Atomic replacement protects readers from partial file contents but does not prevent stale writers.
For every replacement, use this complete protocol:

1. Read the state and retain its revision as `base_revision`.
2. Derive a stable lock key from the normalized project-relative state path. Atomically create the
   corresponding `.maestro/locks/<state-key>.lock/` directory and write owner, acquisition time,
   and lease expiry inside it. Create-if-absent must be exclusive.
3. After acquiring the lock, re-read the state. If its revision differs from `base_revision`, do
   not write. Release the lock, reload the newer state, and either reconcile non-conflicting facts
   with both source paths recorded or return a visible conflict to one designated owner.
4. If the revision still matches, validate the complete replacement, set revision to
   `base_revision + 1`, update `updated_at` and `updated_by`, and atomically replace the file.
5. Re-read enough metadata to confirm the committed revision, then release the lock.

Never force a write after lock contention or a revision mismatch. Retry contention only within a
bounded host-appropriate period. An expired lock may be reclaimed only after the recorded owner is
known inactive; record the prior owner, expiry, reclaiming actor, and timestamp in a transaction or
Evidence record. Clock age alone is insufficient proof that an owner is inactive.

A reconciliation produces a candidate replacement from the newly loaded revision and then starts
the complete protocol again. It is not permission to write outside the lock or skip another
revision check.

If the host cannot guarantee atomic exclusive lock creation, route all writes for that project
through one writer. If neither exclusive locking nor single-writer serialization is available,
report that concurrent mutation is unsupported and do not perform the write.

For an operation that changes several mutable files, acquire every lock in lexical order of the
normalized state paths, recheck every base revision under those locks, and prepare this immutable
transaction bundle before changing canonical state:

```text
.maestro/transactions/<transaction-id>/
  intent.yaml
  before/<state-key>
  staged/<state-key>
  applied/<sequence>.yaml
  committed.yaml | failed.yaml
```

`intent.yaml` records the operation and actor plus, for every create, replacement, or lifecycle
move: normalized source and target paths, base and intended revisions, before and staged snapshot
paths, and SHA-256 hashes. Store the complete bytes under `before/` and `staged/`; a reference may
replace copied bytes only when it addresses immutable, reachable content with the same recorded
hash. A path that did not exist uses an explicit `before: absent` value. Validate every staged file
and make the whole bundle durable before publishing a terminal event.

The terminal event is the logical visibility boundary:

- With only `intent.yaml`, the before view remains authoritative. Staged creates and preparing
  Tasks are non-runnable and invisible to normal routing or resumption.
- Atomically creating `committed.yaml` switches the complete logical view to all staged content at
  once. A lifecycle move is effective at that point even if canonical directories have not yet
  been rearranged.
- `failed.yaml` may be published only before commit and leaves the before view authoritative. Once
  committed, the operation must be finished rather than rolled back.

Create a terminal marker exclusively. If both markers are ever present, treat the transaction as
corrupt and stop for explicit recovery rather than choosing one by timestamp.

After commit, materialize staged content into canonical paths using the normal atomic replacement
rules. After each file replacement or move, append an immutable event under `applied/` with its
path, staged hash, actor, and timestamp. Keep locks until normal materialization completes and
release them in reverse order. If interrupted, a recovery writer reacquires the same locks and
compares each canonical path with the intent:

- A before hash or expected absence means the operation is still pending and the staged content can
  be applied.
- A staged hash means it was already applied and an absent applied event may be reconstructed.
- A hash matching neither snapshot is a concurrent conflict; stop and report it without guessing.

Readers and writers must resolve an incomplete transaction affecting requested state before normal
routing, resumption, or mutation. They may read the transaction overlay directly or finish its
materialization. A committed promotion therefore exposes its Task and excludes its source
Temporary even during cleanup; an uncommitted promotion does the reverse. Prefer a single-file
update when no invariant requires a group.

## File rules

- Resolve every write beneath the selected project's `.maestro/` directory.
- Reject traversal such as `../` and do not follow a supplied absolute path as a state destination.
- Use stable, filesystem-safe IDs containing a UTC timestamp and a short random suffix.
- Prefer Markdown for human-maintained state and YAML for small metadata/configuration.
- Write mutable state only through the revision and lock protocol above, using the host's safest
  available atomic replacement mechanism after conflict checks pass.
- Preserve existing unrelated content and user-authored Playbooks.
- Never delete an active Task, Temporary Memory, Evidence, or Artifact merely because it was
  compressed. Move it to Archive or Trash according to the user's intent.

## State transitions

Storage transitions do not define business workflow. Allowed lifecycle moves are:

- Temporary `active` → `archive` or `trash`.
- Temporary `active` → formal Task after explicit confirmation, then Temporary → `archive`.
- Task active → `archive` after completion.
- Long-term candidate `pending` → `approved` or `rejected` after review.

Record the transition, timestamp, actor/reviewer, rationale when relevant, and source paths before
moving the directory or file.
