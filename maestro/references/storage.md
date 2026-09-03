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
    manifest.md
    index.json
    temporary/
      active/<temporary-id>/
        meta.yaml
        current.md
        handoffs/
        references/
        worker-selections/
        workers/<worker-id>/
          spec.yaml
          current-state.md
          references/
          runs/<run-id>/
            delegation.json
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
      conflicts/
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
        runs/<run-id>/
          delegation.json
    archive/
  workers/
    registry.yaml
  instructions/
    registry.yaml
  playbooks/
    candidates/
    decisions/
```

The `playbooks/` directory may be supplied by the project before Maestro is first used.

## Git tracking boundary

To avoid noisy Git conflicts and keep shared knowledge synchronized across branches, Maestro
separates local execution state from team shared memory:

- **Local Runtime State (Excluded from Git)**:
  - `memory/manifest.md` and `memory/index.json`: derived awareness catalog rebuilt from formal
    Memory sources.
  - `memory/temporary/`: pre-Task exploration, scratchpads, active Worker state.
  - `memory/pending/`: raw uncompressed or unparsed memory worker inputs.
  - `locks/` and `transactions/`: concurrency and filesystem lock markers.
  - `tasks/`: local active task execution state, role current-state, and transient selections.

- **Team Shared Memory (Tracked in Git)**:
  - `memory/long-term/`: `current.md`, `candidates/`, `decisions/`, and `conflicts/`.
  - `playbooks/`: approved team guidance plus reviewed `candidates/` and `decisions/`.
  - `workers/registry.yaml`: reviewed, project-shared reusable Worker specifications.
  - `instructions/registry.yaml`: reviewed project instruction references; built-in refs cannot be overridden.
  - `config.yaml`: shared project configuration.

A target project can enforce this boundary using standard `.gitignore` rules:

```gitignore
# Exclude local Maestro runtime state
.maestro/memory/manifest.md
.maestro/memory/index.json
.maestro/memory/temporary/
.maestro/memory/pending/
.maestro/locks/
.maestro/transactions/
.maestro/tasks/

# Track team shared memory and configurations
!.maestro/
!.maestro/config.yaml
!.maestro/playbooks/
!.maestro/workers/registry.yaml
!.maestro/instructions/registry.yaml
!.maestro/memory/long-term/
```

The built-in Worker registry is immutable installed reference data. A project registry is created
only when reusable project-specific Workers or capability aliases are needed. Selected Worker
specifications are copied into the matching Task or Temporary and never resolved by reference
during execution.

The built-in instruction registry is also immutable installed reference data. A reviewed project
instruction registry may extend it but cannot replace built-in references. Persist each Task- or
Temporary-scoped run's validated `delegation.json` before execution; it records the exact injected
instruction digests, context references, tools, effective permissions, and Host Adapter support
status. Session-scoped packets remain ephemeral.

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

Long-term `current.md` is the current view of approved entries. Each entry exposes a stable
`entry_id`, `memory_kind`, concise content, and reachable `source_refs`; IDs survive wording updates
and are retired only through an immutable decision. Persist every validated Memory Worker proposal,
including `SKIP`, under `memory/long-term/candidates/pending/` until review records it as approved or
rejected. Store unresolved merge conflicts under `memory/long-term/conflicts/` with status
`pending-confirmation`. A `SKIP` decision does not mutate `current.md`, but retaining it prevents
the same duplicate or low-value claim from being reconsidered without new evidence.

Long-term entries use the fenced `maestro-memory-entry` JSON representation defined in
[memory.md](memory.md). This gives the deterministic catalog builder an addressable record boundary
while keeping `current.md` as the authoritative, reviewable source. The generated
`memory/manifest.md` and `memory/index.json` are local cache files, are not shared through Git, and
do not participate in the mutable-state revision protocol. Publish the formal Memory change first,
then rebuild the catalog atomically. A catalog failure never rolls back an already committed formal
Memory write.

Each current Playbook exposes a stable `playbook_id`, canonical `file_path`, title, trigger, ordered
steps, checks, active status, revision metadata, and reachable `source_refs` to Experience Review.
Persist every validated Playbook Candidate,
including `SKIP`, under `playbooks/candidates/` until an immutable record under
`playbooks/decisions/` approves or rejects it. Candidate records include reachable `source_refs`
and `evidence_refs`; they are not active guidance and cannot modify a Playbook before explicit user
approval.

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
id: 20260831-首页启动性能
topic: 首页启动性能
status: active
created_at: 2026-08-31T10:30:00Z
updated_at: 2026-08-31T11:05:00Z
updated_by: old-zhou/session-or-run-id
revision: 12
aliases:
  - home startup performance
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
id: 20260831-优化登录流程
objective: 优化登录流程
status: active
created_at: 2026-08-31T12:00:00Z
updated_at: 2026-08-31T12:03:00Z
updated_by: old-zhou/session-or-run-id
revision: 1
source_temporary: 20260831-首页启动性能
promotion_transaction: 20260831-优化登录流程
```

`source_temporary` is present only when the Task was promoted from Temporary Memory. A Task created
directly from an explicit execution request omits it. A promoted Task also records
`promotion_transaction`, which identifies the transaction whose commit marker controls its initial
visibility. Validate parsed Task metadata against [task.schema.json](schemas/task.schema.json).

## Temporary and Task ID naming

Temporary and Task directories use a readable, filesystem-safe ID derived from their `topic`
(`meta.yaml.topic`) or `objective` (`task.yaml.objective`) rather than an opaque
timestamp-plus-random suffix. The ID must equal the directory name and the value stored in
`meta.yaml.id` / `task.yaml.id`.

### Format

```text
<yyyymmdd>-<slug>
```

- `<yyyymmdd>` is the UTC date on which the directory is created.
- `<slug>` is a short, readable topic name:
  - Keep letters (including CJK), digits, `-`, `_`, and `.`.
  - Remove whitespace, path separators (`/`, `\`), and filesystem-unsafe characters
    (`: * ? " < > |`), plus control characters and leading/trailing dots.
  - Collapse repeated separators. A slug must not begin with `.` (to avoid `.` and `..`).
  - Keep it brief; truncate over-long topics rather than carrying the full sentence.

Examples:

```text
20260831-首页启动性能
20260831-优化登录流程
```

### Duplicate handling

When the target path already exists, append an incrementing numeric suffix starting at `-2`:

```text
20260831-首页启动性能
20260831-首页启动性能-2
20260831-首页启动性能-3
```

Never overwrite an existing directory; a stale read must not reuse a claimed name.

### Stability and compatibility

- Once created, the ID is stable. If the topic or objective is later reworded, update
  `meta.yaml` / `task.yaml` only; do not rename the directory.
- Generate and compare the slug in Unicode **NFC**-normalized form. Host filesystems (for example
  macOS HFS+/APFS) may store or compare file names under NFD, so normalizing on both write and
  comparison keeps the directory name exactly equal to `meta.yaml.id` / `task.yaml.id`.
- Keep the original `<yyyymmdd>-<slug>` when moving a Temporary between `active`, `archive`, and
  `trash`.
- The previous `<utc-timestamp>-<random-suffix>` format (for example `20260827T103000Z-a1b2c3`)
  remains readable and recoverable. Do not batch-migrate existing directories, and do not reject a
  stored ID just because it predates this rule.
- The schemas and validators accept both formats; they require only a filesystem-safe, non-empty
  ID that matches the directory name.

## Mutable-state write protocol

Mutable state includes Temporary `meta.yaml` and `current.md`, Task `task.yaml`, `context.md`,
`decisions.md`, and `progress.md`, role or Worker `current-state.md`, project Worker
`registry.yaml`, Long-term `current.md`, and every canonical formal Playbook Markdown or YAML file.
Each listed
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
- Use stable, filesystem-safe IDs derived from the topic or objective as described in
  "Temporary and Task ID naming"; a stored ID is always accepted even when it uses the older
  timestamp-plus-random-suffix format.
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
- Playbook Candidate `candidate` → `approved`, `rejected`, or `superseded` after explicit user
  review.

An approved `UPDATE`, `MERGE`, or `CREATE` changes Long-term `current.md` through the mutable-state
write protocol. `UPDATE` preserves its target entry ID. `MERGE` preserves one target ID as the
replacement and marks the other targets superseded in the immutable decision. `CREATE` allocates a
new stable entry ID. `SKIP` records only a decision and never creates a current entry.

An approved Playbook `UPDATE`, `MERGE`, or `CREATE` uses the same lock, revision, and transaction
rules for affected Playbook files. `CREATE` allocates one stable `playbook_id` and starts at revision
`0`. `UPDATE` preserves its target ID and path and increments that file's revision exactly once.
`MERGE` names one approved survivor, preserves its ID, increments its revision, and marks every
other target file `superseded` with its own incremented revision and the survivor recorded as
`superseded_by` in the immutable decision. Acquire and recheck all target locks in lexical path
order and publish the multi-file change through one transaction. `SKIP` and rejected candidates
record decisions only. Repeated successful Tasks may append evidence through a reviewed update but
cannot approve a candidate.

Record the transition, timestamp, actor/reviewer, rationale when relevant, and source paths before
moving the directory or file.
