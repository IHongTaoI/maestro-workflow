# Task memory and project memory design

## Scope

This design adds durable V3 project state without restoring V2's Runtime, Controller, adapters, or
host-neutral scheduler. DSH remains the sole Workflow/child-Agent execution owner.

## Layout

```text
.maestro/
  tasks/<task-id>/task.json
  tasks/<task-id>/runs/<run-id>.json
  artifacts/<artifact-id>/content
  artifacts/<artifact-id>/metadata.json
  memory/<memory-id>.json
```

`task.json` contains the schema version, task identifier, status, revision, validated Task Graph,
Graph digest, active run identifier and timestamps. `run-000001.json` is written exactly once and
contains the validated aggregate Workflow result and Artifact identifiers. A task has one active
run so the initial recovery model is deterministic.

## State and commands

`create-task` creates a `ready` task from YAML. `prepare-task-run` creates the next run identifier,
changes the task to `running`, selects only explicitly queried memory, and prints the exact compiled
DSH request. `record-task-run` validates the returned JSON, snapshots declared artifacts, writes the
run receipt, derives a memory entry, then marks the task `completed` when every child has no
blocker, otherwise `blocked`. `revise-task` replaces the validated graph and increments revision
only when no run is active. `query-memory` is a read-only inspection command.

## Safety and retrieval

Task IDs use the existing lowercase kebab-case grammar. All derived paths are fixed below the
resolved project root. Artifact paths must be project-relative regular files, are bounded to 5 MiB,
and are copied as immutable snapshots with SHA-256 metadata. Memory entries are source-linked
summaries of recorded runs. Query token matching is case-insensitive, deterministic and bounded;
empty queries retrieve no project memory. The compiler carries selected excerpts in JSON `args`,
never executable workflow source.
