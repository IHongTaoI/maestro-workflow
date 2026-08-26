# Maestro v1 Phase Two Design

## Goal

Complete the first end-to-end Maestro v1 lifecycle without adding a fixed business state machine.

## Architecture

The existing `MaestroRuntime` remains the host-neutral application boundary. Phase two adds four
orthogonal capabilities: reviewed long-term memory promotion, Task completion and archival,
read-only Playbook discovery, and model-runner adapters. Each capability is callable directly by a
host or through the CLI; none decides which role or business step must run next.

Memory Worker output remains untrusted input. Long-term candidates are normalized, assigned stable
IDs, and stored in a pending directory. Promotion requires an explicit approval flag and records the
reviewer, source references, and promotion timestamp in both the long-term knowledge store and an
immutable decision receipt. Rejected candidates are retained with their review outcome.

Completing a Task asks the Memory Worker for a final compression, persists any new long-term
candidates, writes a completion record, changes Task status to completed, and moves the entire Task
directory from `tasks/active` to `tasks/archive`. A Memory Worker failure records `memory_pending`
and does not prevent archival.

Playbooks are JSON or Markdown files under `.maestro/playbooks`. The Runtime lists and reads them,
but never interprets them as mandatory stages. Path containment and extension checks preserve the
storage boundary.

Model adapters expose a single `createModelRunner` function. Hosts inject an async invocation
function that receives model identity, request payload, and tier; the adapter extracts a JSON object
from common host response shapes and leaves retry/fallback policy in the existing Memory Worker.

## Error handling and compatibility

All write paths remain atomic. Unsafe IDs and paths fail before filesystem access. Existing
first-phase projects are upgraded lazily by `init`, which creates the new directories without
overwriting existing configuration or memory. No vendor SDK or runtime dependency is introduced.

## Verification

Unit tests cover candidate persistence, approval and rejection, Task archival with successful and
pending memory, Playbook listing and containment, adapter response normalization, and existing
phase-one behavior. CLI smoke coverage exercises each new command. Syntax checks enumerate files in
Node so they work consistently on Windows and POSIX shells.
