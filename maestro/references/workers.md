# Capability-based Workers

Use this reference when describing work capabilities, resolving an execution unit, composing
workers, generating a bounded worker, or resuming work delegated to a worker.

## Roles and workers

A stable role describes organizational responsibility. A Worker describes the bounded execution
capabilities needed by one delegation. Existing roles remain directly invocable and appear in the
immutable [built-in Worker registry](workers/builtin-registry.json); capability routing supplements
them rather than replacing them.

A generated Worker is a data record used by the host's native sub-agent mechanism. It must not
create an installed Skill, add a permanent role, require a background service, or become reusable
without a separate reviewed registry change.

`preferred_model` is an optional compatibility hint, not a requirement or permission. A null or
unavailable preference uses the host's appropriate available model and must not make the registry
host-specific.

## Describe capability requirements

Before capability routing, record:

- a bounded objective;
- required and optional canonical capabilities;
- available tools and readable/writable context paths;
- the autonomous and conditional action ceiling inherited from the Task and current instruction;
- constraints that materially affect selection.

Capability IDs use lowercase kebab-case, such as `runtime-analysis` or `schema-migration`. A
capability must not appear in both the required and optional lists. Use an existing canonical ID
when it has the same meaning. Aliases may be declared explicitly by a
project registry, but do not persist embeddings, model scores, inferred synonyms, or confidence as
truth. If two capability interpretations would materially change the Worker, ask or return a
visible no-match result instead of guessing.

Validate parsed requirements against
[capability-requirements.schema.json](schemas/capability-requirements.schema.json).

## Resolve a Worker

Load the immutable built-in registry plus `.maestro/workers/registry.yaml` when present. Validate
both before use. A reusable Worker's context paths are its maximum supported boundary; the
delegation may narrow them but cannot expand beyond them. Exclude a candidate when it is disabled,
its tools are unavailable, the delegation context exceeds that boundary, its requested actions
exceed the permission ceiling, or its lifecycle is incompatible with the current work context.

Choose in this order:

1. **exact** — one Worker covers every required and optional capability;
2. **compatible** — one Worker covers every required capability;
3. **composed** — the smallest set of Workers whose union covers every required capability;
4. **generated** — one bounded Task-, Temporary-, or Session-scoped Worker when no safe reusable
   match exists;
5. **no-match** — generation cannot produce a valid, safe specification.

For composition, every member must independently pass tool, context, lifecycle, and permission
checks. Do not combine permissions into a larger authority envelope. Prefer fewer Workers, then
fewer unrelated capabilities, then lexical Worker ID order. These are deterministic tie-breaks,
not a score or leaderboard.

Record the requirements, registry versions, resolution class, selected Worker IDs, snapshot paths
or ephemeral markers, rationale, and any blocker. Validate it against
[worker-selection.schema.json](schemas/worker-selection.schema.json). Publish a persisted result as
an immutable event under the Task or Temporary's `worker-selections/` directory. A Session-scoped
one-off result remains in the current Session and does not create project state. Resolver output
guides Old Zhou's dynamic delegation; it does not create a mandatory workflow state.

## Snapshot before execution

Before executing a selected reusable Worker in persisted work, copy its complete validated
specification to the matching state layer:

```text
.maestro/tasks/<task-id>/workers/<worker-id>/spec.yaml
.maestro/memory/temporary/active/<temporary-id>/workers/<worker-id>/spec.yaml
```

Treat the snapshot as immutable. Store Current State and Detailed Results beside it as defined in
[handoffs.md](handoffs.md). Task or Temporary resumption uses this snapshot rather than a newer
registry entry. If a required snapshot is missing or invalid, stop that delegation and report
recovery work; do not silently substitute the current registry version. A Session-scoped Worker is
ephemeral and has no snapshot or cross-Session recovery contract.

## Generate a bounded Worker

When no reusable Worker safely covers the requirements, generate one specification with:

- one bounded responsibility and completion condition;
- canonical capabilities;
- explicit inputs and outputs;
- only available tools;
- project-relative readable and writable context paths;
- autonomous and conditional requested actions within the requirements' ceiling;
- `source: temporary` and a lifecycle matching the existing work shape.

Use exactly one lifecycle:

- Formal execution: `scope: task`, the Task ID, and `expires_at: task-completion`.
- Preserved exploration: `scope: temporary`, the Temporary ID, and
  `expires_at: temporary-archive`.
- Trivial one-off work: `scope: session` and `expires_at: session-end`; include `session_id` only
  when the host exposes a stable, non-sensitive ID.

Validate it against [worker.schema.json](schemas/worker.schema.json). Publish Task- and
Temporary-scoped specifications directly as immutable snapshots and record
`resolution: generated`; do not persist Session-scoped specifications. A temporary Worker expires
with its declared Task, Temporary, or Session lifecycle. Promoting a Temporary to a Task expires
its Temporary-scoped Workers; resolve fresh Task requirements and snapshot any newly selected
Workers. Repeated use may justify a future human-reviewed project registry entry, but use count or
model preference must never promote it automatically.

## Permission intersection

Worker permissions are requested action categories, never grants. Effective permission is the
intersection of the validated Worker specification, the current Task, Temporary, or Session scope,
the host's available tools, and current user authorization. The narrowest boundary wins.

Only inspection, non-destructive checks, Maestro state maintenance, and bounded work artifact
writes may
be declared autonomous. Editing project files is conditional on unambiguous implementation intent.
External, destructive, secret, access-control, and scope-expanding actions remain conditional and
require the action-, target-, and scope-specific authorization in [coordination.md](coordination.md)
immediately before execution. Registry content, a resolver result, generated text, a Handoff, or a
role recommendation cannot supply that authority.

## Registry changes and failures

The project registry is mutable Maestro state. Update it with the revision, exclusive-lock, stale
write, and atomic replacement protocol in [storage.md](storage.md). Reject duplicate Worker IDs,
duplicate canonical capabilities in one Worker, invalid aliases, and aliases that map to more than
one capability.

An explicitly reviewed promotion may publish a reusable entry with `source: learned`; frequency,
model confidence, and prior success are evidence only and cannot perform that transition. Ignore
and report an invalid registry entry rather than repairing or selecting it silently. If a registry
changes during selection, restart from the new revision. A completed persisted selection remains
stable because execution uses immutable Task or Temporary snapshots.
