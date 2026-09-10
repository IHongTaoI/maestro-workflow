# Activity Timeline Design

## Context

Long-term Memory answers "what does this project know now", but it deliberately does not retain a
full chronological work log. When the user asks "what did we do this month" or "what did we finish
this year", completed Tasks, Temporary investigations, and approved Decisions that never became
Long-term knowledge are invisible.

Issue #54 asks for a queryable Activity / Timeline view. It must not add a fourth Memory layer,
must not become a second business fact source, and must not dump process noise into the timeline.

## Selected design

Formal Task / Decision / Memory / Playbook / Worker records stay authoritative. A deterministic
`activity_catalog.py` helper maintains a small append-only event log plus two derived caches:

```text
.maestro/activity/
  events/<yyyy>/<mm>.jsonl    # append-only, the single source of truth
  index.json                   # derived cache, deterministically rebuilt from events/
  <yyyy>/<mm>.md              # human-readable monthly view, regenerated from events/
```

The event log is the only authoritative activity record. An event is appended at the moment it
happens, carrying a wall-clock `occurred_at`. The index and monthly Markdown are derived caches that
can be deleted and rebuilt without losing history. Event time is never inferred from file mtime,
because checkout, sync, and copy would corrupt it.

## Decision 2: closed event_type allow-list

"Only collect high-value events" needs an enforceable rule. `event_type` is a closed enum; anything
outside the allow-list is rejected:

```text
task_completed
task_archived
temporary_promoted
decision_approved
memory_updated          # Long-term CREATE / UPDATE / MERGE
playbook_approved
worker_approved
checkpoint_created
```

Phase 1 implements only `task_completed` and `decision_approved`. Each additional type must add its
own source parsing and schema validation before it is accepted.

## Event model (Phase 1)

```json
{
  "event_id": "activity-20260910-a1b2c3d4",
  "occurred_at": "2026-09-10T12:00:00Z",
  "event_type": "task_completed | decision_approved",
  "title": "完成老周单入口与动态执行者重构",
  "summary": "#48 完成并关闭，老周成为唯一预置入口。",
  "source_refs": [".maestro/tasks/..."],
  "status": "completed"
}
```

- `event_id` is deterministic: `activity-<yyyymmdd>-<sha256(seed)[:8]>` unless the caller supplies
  an explicit ID. Deterministic IDs make recording idempotent — appending the same event twice
  produces no duplicate.
- `occurred_at` is ISO 8601 UTC, generated when the event happens, and taken from a reliable source
  field (Task lifecycle, Decision timestamp, immutable record timestamp) rather than mtime.
- `source_refs` points back to authoritative records. Timeline entries never copy Long-term Memory
  body text; they only link to it.

## Decision 4: Timeline and Long-term Memory share references, not body text

`decision_approved` appears in both Long-term Memory ("this decision is in effect") and Timeline
("this decision was approved in month X"). To avoid two diverging copies:

- Timeline records only event metadata plus `source_refs` to the Long-term entry / Decision record;
- Long-term Memory keeps only currently-effective facts and never stores the full timeline;
- neither copies the other's body text.

## Data flow and authority

```text
authoritative Task / Decision / Memory / Playbook records
        ↓  (event emitted at the moment it happens)
events/<yyyy>/<mm>.jsonl
        ↓  (deterministic build)
index.json
        ↓  (time-window query)
monthly / yearly review
```

Recording is append-only and idempotent by `event_id`. Building scans the event log, deduplicates by
`event_id`, sorts by `occurred_at`, and writes `index.json` with a SHA-256 `source_digest` over the
event files for stale detection. Search reads the index (rebuilding it if missing or stale) and
filters by month, year, or an arbitrary from/to range.

## Query protocol

```text
activity_catalog.py --project-root <root> search --month 2026-09
activity_catalog.py --project-root <root> search --year 2026
activity_catalog.py --project-root <root> search --from 2026-09-01 --to 2026-09-30
```

Old Zhou routes "what do we know now" to Long-term Memory and "what did we do" to the Activity
Timeline, then drills into `source_refs` for detail.

## Error handling

Invalid events (unknown `event_type`, missing fields, malformed timestamp, unreachable
`source_refs`) fail validation before any write. Recording the same `event_id` twice is a no-op, not
an error. A missing or corrupt index rebuilds from the event log on demand. A build failure cannot
roll back or block already-appended events.

## Deferred work

`related_ids` graph traversal, monthly rollup aggregation for compact yearly review, and the
remaining six event types are later phases. They are not prerequisites for the Phase 1 closed loop.
