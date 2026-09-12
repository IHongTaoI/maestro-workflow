# DSH checkpoint recovery fix

## Context

Issue #69 acceptance found two related problems. Automatic project binding
partitioned an explicitly configured `recoveryRoot` before constructing a
`CheckpointWriter`, while the writer partitioned it again. This produced
`<root>/<project-hash>/<project-hash>/...` instead of the documented single
project partition. A real Windows write-failure test also returned only the
generic `storage_or_validation_error`, making it impossible to distinguish a
secondary archive failure from a later primary write failure.

## Design

The tool layer passes the configured recovery base directory unchanged. The
writer remains the single owner of canonical project partitioning using the
resolved project identity. This keeps configured and default recovery roots on
the same layout and preserves isolation between projects and path aliases.

The writer tracks a small, stable failure stage while processing save or retry:
`validation`, `secondary_write`, `project_request`, `canonical_write`, or
`observation_write`. Failure responses expose this value alongside the existing
error code and recovery state. Stages do not include paths, exception messages,
or filesystem details. Once a secondary request record has been verified,
subsequent primary failures continue to report `recovery: secondary`.

## Verification

Regression tests assert that automatic binding creates only one project-hash
partition, that a primary request failure after secondary capture reports the
project-request stage and remains recoverable, and that failure of both storage
channels reports the secondary-write stage without claiming recovery. The full
Adapter test, typecheck, build, and package checks must pass. Final acceptance
still requires rebuilding/installing the Adapter and repeating the real DSH
Windows permission-failure scenario.
