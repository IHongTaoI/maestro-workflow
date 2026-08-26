# Maestro V3 implementation contract

## Ownership boundary

Maestro is the trust root for project state, lifecycle, permissions, memory, result validation and
delivery gates. DSH is the execution host. Maestro compiles a fixed Workflow request but never
pretends that compilation proves live execution.

## Durable roots

```text
.agents/.local/work/<workspace-id>/
  meta.json
  events.jsonl
  progress.md
  input/request.md
  diagnosis/
  requirements/
  design/
  planning/
  implementation/
  testing/
  delivery/
  checkpoints/
  runtime/

.maestro/
  host.json
  tasks/<task-id>/
  artifacts/<artifact-id>/
  drafts/<draft-id>.json
  memory/<memory-id>.json
  memory/current-summary.md
  wiki/<wiki-id>/current.json
  wiki/<wiki-id>/v000001.json
```

Session IDs are never business state. A fresh session reconstructs work from these roots. Mutable
pointers use same-directory atomic replacement; immutable records use exclusive atomic creation.
Read-modify-write operations use project locks, and record commits use deterministic IDs plus a
commit journal so retries can continue safely.

## Lifecycle gates

The Runtime owns stage transitions. A role may create an artifact but cannot declare its stage
passed. Leaving a stage validates its required artifacts and freezes their SHA-256 hashes in a
checkpoint. Testing and delivery parse explicit status markers; missing and `not_run` are failures.

Revisions never mutate a checkpoint. Minor, Major and Critical requests move the current pointer to
an allowed stage and increment that stage revision. Critical revisions return a Workflow workspace
to requirements.

Diagnosis is a separate mode for unknown bug roots and performance bottlenecks. It remains in an
evidence loop until its report confirms a baseline, root cause, supporting evidence and success
metric. The Runtime rejects an attempted transition while the report is still investigating or any
required field is absent. A static implementation Task Graph is frozen only after that gate.

## Role execution

Old Zhou is a clean controller and user translator. Roles do concrete work and return schema-valid
results. The Orchestrator produces a frozen plan and execution ledger. Write-set overlap serializes
otherwise dependency-ready tasks. A task has one to three attempts; exhausting attempts produces a
blocked result rather than an unbounded loop.

DSH Goal state is not part of Maestro orchestration. The Skill forbids an implicit `create_goal`
call and treats a live delegated Agent as a valid controller wait state. No-file-yet is not failure;
after an intentional cancellation the controller may re-route work but may not implement it.

## Memory promotion

Temporary drafts are never injected as facts. Task memory is immutable and source-linked; role
state is compact and previous states move to history. Wiki promotion is an explicit command that
requires existing source Memory IDs and creates a new Wiki revision. Retrieval excludes superseded
entries, ranks tags and scoped task/role matches, prefers newer ties, includes evidence references,
and skips a damaged entry instead of poisoning the entire query.

## Core protocol

The only trusted mutation path is:

1. `submit_proposal`
2. `apply_permissions`
3. `validate_proposal`
4. host execution
5. `collect_result`
6. `commit_memory`

Path permissions are project-relative and default deny. Runtime-owned metadata, audit events,
requests and memory cannot be granted to roles. Collected files must be declared outputs, regular
files and inside the project root; their digest and length become evidence.

## Capability probes

P01-P07 are executable acceptance checks, not self-reported capability flags. A failed probe returns
a failed host report and the Skill requires Old Zhou to stop before starting a Workflow.

## Compatibility

Existing schema-version-1 Task Graphs remain valid: missing `writes` defaults to an empty set and
missing `maxAttempts` defaults to three. Legacy `planner` and `tester` roles remain recognized.
Existing prepared run receipts can still resume; new completions use a separate `.result.json`.
The parser also normalizes the controlled legacy aliases `version: 1` and task `title`; canonical
new graphs omit `version` and use `description`.
