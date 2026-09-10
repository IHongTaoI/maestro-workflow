#!/usr/bin/env python3
"""Record, build, check, and search the Maestro Activity Timeline.

The activity timeline is a derived, queryable view of project work history. Its single source of
truth is an append-only event log under `.maestro/activity/events/<yyyy>/<mm>.jsonl`; `index.json`
and any monthly Markdown views are derived caches that can be deleted and rebuilt.

Event time (`occurred_at`) is generated when the event happens and is normalized to UTC. It is never
inferred from file mtime. `event_type` is a closed allow-list; Phase 1 accepts only `task_completed`
and `decision_approved`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from validate import (
    Diagnostic,
    FileReferenceValidator,
    validate_activity_event,
    validate_activity_index,
)


ACTIVITY_ROOT = Path(".maestro/activity")
EVENTS_ROOT = ACTIVITY_ROOT / "events"
INDEX_PATH = ACTIVITY_ROOT / "index.json"
EVENT_TYPES = {"task_completed", "decision_approved"}


class CatalogError(ValueError):
    pass


def resolve_reference_time(arg_time: str | None = None) -> datetime | None:
    if arg_time is None:
        return None
    try:
        dt = datetime.fromisoformat(arg_time.replace("Z", "+00:00"))
    except ValueError as error:
        raise CatalogError(f"invalid --now timestamp '{arg_time}': {error}") from error
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise CatalogError(
            f"--now timestamp must include timezone offset (e.g. 'Z' or '+00:00'): '{arg_time}'"
        )
    return dt


def utc_now(reference_time: datetime | None = None) -> str:
    current = reference_time if reference_time is not None else datetime.now(timezone.utc)
    return current.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def normalize_utc(value: str) -> str:
    """Parse an RFC 3339 timestamp and return it normalized to UTC with a 'Z' suffix."""
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise CatalogError(f"invalid timestamp '{value}': {error}") from error
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise CatalogError(f"timestamp must include timezone offset: '{value}'")
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def make_event_id(
    event_type: str,
    occurred_at: str,
    title: str,
    summary: str,
    source_refs: list[str],
) -> str:
    seed = "\n".join([event_type, occurred_at, title, summary] + sorted(source_refs))
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:8]
    ymd = occurred_at[:10].replace("-", "")
    return f"activity-{ymd}-{digest}"


def events_file_for(occurred_at: str) -> Path:
    year = occurred_at[:4]
    month = occurred_at[5:7]
    return EVENTS_ROOT / year / f"{month}.jsonl"


def validate_event(project_root: Path, event: dict[str, Any]) -> list[Diagnostic]:
    errors: list[Diagnostic] = []
    validate_activity_event(event, "$", errors, FileReferenceValidator(project_root))
    return errors


def load_events(project_root: Path) -> list[dict[str, Any]]:
    """Scan the append-only event log, dedupe by event_id, and sort by occurred_at.

    Malformed lines are skipped so a partially-written append cannot poison the whole view.
    """
    events_root = project_root / EVENTS_ROOT
    if not events_root.is_dir():
        return []
    deduped: dict[str, dict[str, Any]] = {}
    for path in sorted(events_root.rglob("*.jsonl")):
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeError):
            continue
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(event, dict):
                continue
            event_id = event.get("event_id")
            if isinstance(event_id, str):
                deduped.setdefault(event_id, event)
    events = list(deduped.values())
    events.sort(key=lambda item: str(item.get("occurred_at", "")))
    return events


def source_digest(project_root: Path) -> str:
    events_root = project_root / EVENTS_ROOT
    digest = hashlib.sha256()
    if not events_root.is_dir():
        return digest.hexdigest()
    for path in sorted(events_root.rglob("*.jsonl")):
        relative = path.relative_to(project_root).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        try:
            digest.update(path.read_bytes())
        except OSError as error:
            raise CatalogError(f"cannot hash {path}: {error}") from error
        digest.update(b"\0")
    return digest.hexdigest()


def derive_index(project_root: Path, *, now: datetime | None = None) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "generated_at": utc_now(now),
        "source_digest": source_digest(project_root),
        "events": load_events(project_root),
    }


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def persist_index(project_root: Path, index: dict[str, Any]) -> None:
    atomic_write(
        project_root / INDEX_PATH,
        json.dumps(index, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )


def load_index(project_root: Path) -> dict[str, Any] | None:
    path = project_root / INDEX_PATH
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict):
        return None
    errors: list[Diagnostic] = []
    validate_activity_index(value, errors, FileReferenceValidator(project_root))
    if errors:
        return None
    return value


def index_is_current(project_root: Path, index: dict[str, Any]) -> bool:
    return index.get("source_digest") == source_digest(project_root)


def record_event(project_root: Path, event: dict[str, Any]) -> bool:
    """Append one event to the log. Returns False if the event was already recorded.

    Recording is idempotent: a deterministic event_id means appending the same event twice is a
    no-op rather than a duplicate.
    """
    errors = validate_event(project_root, event)
    if errors:
        messages = "; ".join(f"{error.path}: {error.message}" for error in errors)
        raise CatalogError(f"invalid activity event: {messages}")

    existing = load_events(project_root)
    if any(item.get("event_id") == event["event_id"] for item in existing):
        return False

    path = project_root / events_file_for(event["occurred_at"])
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n"
    with open(path, "a", encoding="utf-8", newline="\n") as stream:
        stream.write(line)
        stream.flush()
        os.fsync(stream.fileno())
    return True


def ensure_current_index(
    project_root: Path, *, refresh: bool, now: datetime | None = None
) -> tuple[dict[str, Any], bool]:
    index = load_index(project_root)
    if index is not None and index_is_current(project_root, index):
        return index, False
    if not refresh:
        raise CatalogError("activity index is missing or stale; rerun without --no-refresh")
    index = derive_index(project_root, now=now)
    persist_index(project_root, index)
    return index, True


def in_range(occurred_at: str, from_: str | None, to: str | None) -> bool:
    if from_:
        start = from_ if "T" in from_ else from_ + "T00:00:00Z"
        if occurred_at < start:
            return False
    if to:
        end = to if "T" in to else to + "T23:59:59Z"
        if occurred_at > end:
            return False
    return True


def filter_events(
    events: list[dict[str, Any]],
    *,
    month: str | None,
    year: str | None,
    from_: str | None,
    to: str | None,
    event_type: str | None,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for event in events:
        occurred = str(event.get("occurred_at", ""))
        if month and not occurred.startswith(month + "-"):
            continue
        if year and not occurred.startswith(year + "-"):
            continue
        if not in_range(occurred, from_, to):
            continue
        if event_type and event.get("event_type") != event_type:
            continue
        result.append(event)
    return result


def parse_args(argv: list[str]) -> argparse.Namespace:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--project-root", type=Path, default=argparse.SUPPRESS)
    common.add_argument(
        "--now",
        help="Fixed ISO-8601 timestamp for reproducible builds or tests",
        default=argparse.SUPPRESS,
    )

    parser = argparse.ArgumentParser(
        description="Maintain Maestro's derived Activity Timeline.",
        parents=[common],
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("build", parents=[common])
    subparsers.add_parser("check", parents=[common])

    record = subparsers.add_parser("record", parents=[common])
    record.add_argument("--event-type", required=True, choices=sorted(EVENT_TYPES))
    record.add_argument("--occurred-at", required=True)
    record.add_argument("--title", required=True)
    record.add_argument("--summary", required=True)
    record.add_argument("--source-ref", required=True, action="append", dest="source_refs")
    record.add_argument("--event-id")

    search = subparsers.add_parser("search", parents=[common])
    search.add_argument("--month")
    search.add_argument("--year")
    search.add_argument("--from", dest="from_")
    search.add_argument("--to")
    search.add_argument("--event-type", choices=sorted(EVENT_TYPES))
    search.add_argument("--no-refresh", action="store_true")

    args = parser.parse_args(argv)
    if not hasattr(args, "project_root"):
        args.project_root = Path.cwd()
    if not hasattr(args, "now"):
        args.now = None
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        project_root = args.project_root.resolve(strict=True)
        if not project_root.is_dir():
            raise CatalogError(f"project root is not a directory: {project_root}")
        reference_time = resolve_reference_time(args.now)

        if args.command == "record":
            occurred_at = normalize_utc(args.occurred_at)
            source_refs = list(dict.fromkeys(args.source_refs))
            event_id = args.event_id or make_event_id(
                args.event_type, occurred_at, args.title, args.summary, source_refs
            )
            event = {
                "event_id": event_id,
                "occurred_at": occurred_at,
                "event_type": args.event_type,
                "title": args.title,
                "summary": args.summary,
                "source_refs": source_refs,
                "status": "completed",
            }
            recorded = record_event(project_root, event)
            print(
                json.dumps(
                    {
                        "status": "recorded" if recorded else "already-recorded",
                        "event_id": event_id,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                )
            )
            return 0

        if args.command == "build":
            index = derive_index(project_root, now=reference_time)
            persist_index(project_root, index)
            print(json.dumps({"status": "built", "events": len(index["events"])}, sort_keys=True))
            return 0

        if args.command == "check":
            expected = derive_index(project_root, now=reference_time)
            current = load_index(project_root)
            if current is None or not index_is_current(project_root, current):
                print("Activity index is missing or stale", file=sys.stderr)
                return 1
            print(
                json.dumps({"status": "current", "events": len(current["events"])}, sort_keys=True)
            )
            return 0

        index, refreshed = ensure_current_index(
            project_root, refresh=not args.no_refresh, now=reference_time
        )
        events = filter_events(
            index["events"],
            month=args.month,
            year=args.year,
            from_=args.from_,
            to=args.to,
            event_type=args.event_type,
        )
        print(
            json.dumps(
                {
                    "month": args.month,
                    "year": args.year,
                    "from": args.from_,
                    "to": args.to,
                    "event_type": args.event_type,
                    "catalog_refreshed": refreshed,
                    "events": events,
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
        )
        return 0
    except (CatalogError, OSError, RuntimeError, ValueError) as error:
        print(f"activity catalog error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
