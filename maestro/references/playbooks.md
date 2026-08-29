# Playbooks

Playbooks are optional project-authored guidance stored under `.maestro/playbooks/` as Markdown or
YAML. They may suggest roles, checks, evidence, or typical sequencing.

Long-term Memory answers "what do we know about this project?" A Playbook answers "when this kind
of situation occurs, what evidence-backed method should we consider?" A Playbook therefore has an
explicit trigger, ordered reusable steps, and checks. Project facts, one-off commands, temporary
experiments, exact Task chronology, and unverified suggestions are not Playbooks.

## Playbook Candidates

At an Experience Review boundary, the Memory Worker may emit `playbook_candidates` beside
Long-term candidates. This does not add another Worker role. Every candidate records:

- a stable `candidate_id`, title, trigger, ordered `steps`, and `checks`;
- an `action` and match classification against stable current `playbook_id` values;
- rationale, structured source metadata, reachable `source_refs`, and reachable `evidence_refs`;
- `status: candidate`.

Temporary or Task material may be a source, but every non-`SKIP` candidate must be grounded in real
execution evidence. A discussion that merely sounds plausible cannot establish a reusable method.
Evidence of one successful execution may justify a candidate, never automatic promotion.

Classify and maintain candidates in this order:

```text
UPDATE → MERGE → CREATE → SKIP
```

- `CREATE` requires a novel procedure and targets no current Playbook.
- `UPDATE` targets exactly one overlapping or conflicting Playbook.
- `MERGE` targets at least two overlapping or conflicting Playbooks.
- `SKIP` records either a duplicate with targets or low-value material with none.

Prefer maintaining coherent Playbooks over creating near-duplicates. Persist validated proposals,
including `SKIP`, under `.maestro/playbooks/candidates/` and immutable review records under
`.maestro/playbooks/decisions/`. Rejected candidates remain auditable so the same weak procedure is
not repeatedly proposed without new evidence.

The Memory Worker cannot approve a candidate or write a formal Playbook. In the first version,
promotion requires explicit user approval. Repeated success may add evidence but grants no automatic
promotion authority. An approved action uses the mutable-state write protocol, preserves existing
evidence and decision history, and never grants permissions beyond the user's current authorization.

Candidates are not active guidance. Only approved, current Playbooks are eligible for selection.

## Canonical Playbook files

A managed formal Playbook is one Markdown or YAML file under `.maestro/playbooks/`, excluding the
reserved `candidates/` and `decisions/` directories. YAML exposes the fields below at its top level;
Markdown exposes the same fields in YAML front matter and may use its body for human explanation:

```yaml
playbook_id: pb-20260829t000000z-a1b2
file_path: .maestro/playbooks/performance-diagnosis.md
title: Evidence-first performance diagnosis
trigger: A user asks to diagnose a runtime performance regression.
steps:
  - Capture runtime evidence before proposing a cause.
checks:
  - Evidence is reachable from the source Task.
status: active
revision: 0
updated_at: 2026-08-29T00:00:00Z
updated_by: old-zhou/session-or-run-id
source_refs:
  - .maestro/tasks/archive/task-id/evidence/trace.md
```

`playbook_id` never changes after creation. `file_path` is the normalized project-relative path to
the same file. Active Playbooks are normalized into `current_playbooks`; files with
`status: superseded` remain historical and are excluded. `revision`, `updated_at`, and `updated_by`
follow the mutable-state protocol in [storage.md](storage.md).

### Legacy migration

Before the first Experience Review, scan project-authored Markdown and YAML directly under the
Playbook tree while excluding reserved candidate and decision records. If any formal Playbook lacks
the canonical fields, stop Experience Review instead of silently omitting it or inventing a new ID
on every run.

Offer a one-time migration for explicit user approval. The reviewed migration maps the existing
title, trigger, ordered steps, and checks, adds `status: active`, allocates and persists one stable
`playbook_id`, records the existing path as `file_path`, sets `revision: 0`, and preserves the
original bytes in an immutable migration/transaction snapshot referenced by `source_refs`. Apply all
approved file normalizations in one transaction.
Future reads use the stored ID; they never regenerate it from a heading, content hash, or model
output. If the user declines migration, the legacy file remains usable when explicitly selected,
but automated Experience Review remains pending rather than comparing against an incomplete index.

When a user asks to follow a Playbook:

1. Read the named Playbook. If none is named, select one only when its purpose clearly matches.
2. Explain any material implication that affects scope, cost, risk, or external actions.
3. Adapt its recommendations to the current task and available evidence.
4. Follow the user's current instruction when it conflicts with optional Playbook guidance, unless
   doing so would violate a safety or authorization boundary.

Do not turn Playbook sections into mandatory Runtime states. Skip irrelevant roles and insert a
needed role when current evidence justifies it. The user may change the path at any time.

Do not modify a project-authored Playbook unless the user explicitly approves the reviewed action.
No Playbook or candidate may bypass safety checks, authorize an external action, or force a fixed
Role sequence.
