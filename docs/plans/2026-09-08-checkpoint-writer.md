# Checkpoint Writer Implementation Plan

**Goal:** Expose an opt-in DSH tool for inspecting, saving and retrying a single existing Temporary/Task checkpoint.

**Architecture:** The current Agent supplies bounded structured snapshot facts. A complete immutable request (source and proposal together) is published before the guarded current-state write. An optional operator-configured recovery directory outside the project holds the same request; it is not a new Memory layer. Core chooses the target; trusted host configuration binds the project and recovery root.

**Scope:** Snapshot mode, Temporary current.md and Task progress.md. No automatic triggers, transcript capture, Worker targets, lifecycle changes or multi-file business transactions. Tool activation and tests do not claim live model-provider acceptance.

1. Verify fixed DSH tools/persistence types; install development-only type dependencies.
2. Add Core checkpoint request schema and semantic validation, guarded writer and retry reconciliation.
3. Register inspect/save/status/retry operations through a typed ToolDefinition, gated by explicit configuration and available fs/tools. Bind caller cwd from Agent Session header.
4. Test CAS conflicts, idempotency, invalid records, interruption after commit, primary-store failure with recovery directory, cancellation, lifecycle changes and cross-project calls.
5. Update Core references, DSH README and architecture status. Run typecheck, adapter tests, package checks and relevant Core contract tests. Commit and open a PR referencing #14/#26 without closing them.

Protocol refinement from the first PR: one exclusive JSON request embeds source and proposal instead of three preparation files. This removes orphan-preparation ordering without changing the one-file current-state commit authority. No transcript append or host event vocabulary is invented.
