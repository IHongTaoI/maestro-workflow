#!/usr/bin/env python3
"""Build, check, search, and selectively read Maestro's derived Memory catalog."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from validate import Diagnostic, FileReferenceValidator, validate_memory_index


INDEX_PATH = Path(".maestro/memory/index.json")
MANIFEST_PATH = Path(".maestro/memory/manifest.md")
LONG_TERM_PATH = Path(".maestro/memory/long-term/current.md")
LONG_TERM_FENCE = re.compile(
    r"^```maestro-memory-entry[ \t]*\r?\n(.*?)^```[ \t]*$",
    re.MULTILINE | re.DOTALL,
)
HEADING = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t]*$", re.MULTILINE)
LATIN_TOKEN = re.compile(r"[a-z0-9][a-z0-9._-]*", re.IGNORECASE)
CJK_RUN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]+")
STABLE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
ACTIVE_STATUSES = {"active"}
LONG_TERM_KINDS = {"fact", "experience", "principle", "decision", "constraint", "other"}


class CatalogError(ValueError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def project_relative(project_root: Path, path: Path) -> str:
    return path.resolve().relative_to(project_root.resolve()).as_posix()


def unique_strings(values: Iterable[Any]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        normalized = " ".join(value.split()).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def compact_text(value: str, limit: int = 240) -> str:
    compact = " ".join(value.split()).strip()
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"


def parse_scalar(raw: str) -> Any:
    value = raw.strip()
    if not value:
        return ""
    if value in {"null", "~"}:
        return None
    if value in {"true", "false"}:
        return value == "true"
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    if value.startswith("[") or value.startswith("{") or value.startswith('"'):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            pass
    if len(value) >= 2 and value[0] == value[-1] == "'":
        return value[1:-1].replace("''", "'")
    return value


def parse_simple_yaml(path: Path) -> dict[str, Any]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as error:
        raise CatalogError(f"cannot read {path}: {error}") from error
    result: dict[str, Any] = {}
    current_list: str | None = None
    for line_number, line in enumerate(lines, start=1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        list_match = re.fullmatch(r"\s+-\s+(.+?)\s*", line)
        if list_match and current_list is not None:
            assert isinstance(result[current_list], list)
            result[current_list].append(parse_scalar(list_match.group(1)))
            continue
        if line[0].isspace():
            continue
        match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*", line)
        if match is None:
            raise CatalogError(f"{path}:{line_number}: unsupported top-level YAML")
        key, raw_value = match.groups()
        if not raw_value:
            result[key] = []
            current_list = key
        else:
            result[key] = parse_scalar(raw_value)
            current_list = None
    return result


def strip_front_matter(text: str) -> str:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return text
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() in {"---", "..."}:
            return "\n".join(lines[index + 1 :])
    return text


def markdown_sections(text: str) -> dict[str, str]:
    body = strip_front_matter(text)
    matches = list(HEADING.finditer(body))
    sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        start = match.end()
        end = len(body)
        current_level = len(match.group(1))
        for later in matches[index + 1 :]:
            if len(later.group(1)) <= current_level:
                end = later.start()
                break
        name = match.group(2).strip().casefold()
        sections[name] = body[start:end].strip()
    return sections


def section_values(text: str, names: Iterable[str]) -> list[str]:
    sections = markdown_sections(text)
    result: list[str] = []
    for name in names:
        value = sections.get(name.casefold(), "")
        if value:
            result.append(compact_text(value, 400))
    return unique_strings(result)


def read_optional(path: Path) -> str:
    if not path.is_file():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise CatalogError(f"cannot read {path}: {error}") from error


def require_string(mapping: dict[str, Any], key: str, source: Path) -> str:
    value = mapping.get(key)
    if not isinstance(value, str) or not value.strip():
        raise CatalogError(f"{source}: '{key}' must be a non-empty string")
    return value.strip()


def optional_string_list(mapping: dict[str, Any], key: str, source: Path) -> list[str]:
    value = mapping.get(key, [])
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise CatalogError(f"{source}: '{key}' must be a string array")
    return unique_strings(value)


def require_string_list(mapping: dict[str, Any], key: str, source: Path) -> list[str]:
    values = optional_string_list(mapping, key, source)
    if not values:
        raise CatalogError(f"{source}: '{key}' must contain at least one string")
    return values


def validate_decision_context(entry: dict[str, Any], source: Path) -> None:
    context = entry.get("decision_context")
    if context is None:
        return
    if entry.get("memory_kind") != "decision":
        raise CatalogError(
            f"{source}: 'decision_context' is allowed only for memory_kind 'decision'"
        )
    if not isinstance(context, dict):
        raise CatalogError(f"{source}: 'decision_context' must be an object")
    unknown = set(context) - {"reason", "rejected_alternatives"}
    if unknown:
        raise CatalogError(
            f"{source}: 'decision_context' contains unknown fields: {sorted(unknown)}"
        )
    require_string(context, "reason", source)
    alternatives = context.get("rejected_alternatives", [])
    if not isinstance(alternatives, list):
        raise CatalogError(
            f"{source}: 'decision_context.rejected_alternatives' must be an array"
        )
    for alternative in alternatives:
        if not isinstance(alternative, dict):
            raise CatalogError(
                f"{source}: each rejected alternative must be an object"
            )
        if set(alternative) != {"alternative", "reason"}:
            raise CatalogError(
                f"{source}: each rejected alternative requires only 'alternative' and 'reason'"
            )
        require_string(alternative, "alternative", source)
        require_string(alternative, "reason", source)


def parse_long_term_entries(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    text = read_optional(path)
    blocks = list(LONG_TERM_FENCE.finditer(text))
    if not blocks:
        meaningful = strip_front_matter(text).strip()
        if meaningful and meaningful not in {"# Long-term Memory", "# Long-term memory"}:
            raise CatalogError(
                f"{path}: Long-term entries must use fenced 'maestro-memory-entry' JSON blocks"
            )
        return []
    entries: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, block in enumerate(blocks, start=1):
        try:
            entry = json.loads(block.group(1))
        except json.JSONDecodeError as error:
            raise CatalogError(
                f"{path}: entry block {index} contains invalid JSON: {error.msg}"
            ) from error
        if not isinstance(entry, dict):
            raise CatalogError(f"{path}: entry block {index} must contain a JSON object")
        entry_id = require_string(entry, "entry_id", path)
        if not STABLE_ID.fullmatch(entry_id):
            raise CatalogError(f"{path}: invalid entry_id '{entry_id}'")
        if entry_id in seen:
            raise CatalogError(f"{path}: duplicate entry_id '{entry_id}'")
        seen.add(entry_id)
        require_string(entry, "title", path)
        kind = require_string(entry, "memory_kind", path)
        if kind not in LONG_TERM_KINDS:
            raise CatalogError(f"{path}: invalid memory_kind '{kind}'")
        require_string(entry, "content", path)
        require_string_list(entry, "source_refs", path)
        status = entry.get("status", "active")
        if status not in {"active", "disputed", "superseded", "rejected"}:
            raise CatalogError(f"{path}: invalid status '{status}'")
        optional_string_list(entry, "tags", path)
        optional_string_list(entry, "aliases", path)
        validate_decision_context(entry, path)
        entries.append(entry)
    return entries


def long_term_index_entries(project_root: Path, source_files: set[Path]) -> list[dict[str, Any]]:
    path = project_root / LONG_TERM_PATH
    if not path.is_file():
        return []
    source_files.add(path)
    text = read_optional(path)
    front_matter = {}
    if text.startswith("---"):
        lines = text.splitlines()
        closing = next(
            (
                index
                for index, line in enumerate(lines[1:], 1)
                if line.strip() in {"---", "..."}
            ),
            None,
        )
        if closing is not None:
            for line in lines[1:closing]:
                match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*", line)
                if match:
                    front_matter[match.group(1)] = parse_scalar(match.group(2))
    updated_at = front_matter.get("updated_at")
    if not isinstance(updated_at, str):
        updated_at = None
    result: list[dict[str, Any]] = []
    for entry in parse_long_term_entries(path):
        content = require_string(entry, "content", path)
        result.append(
            {
                "memory_id": require_string(entry, "entry_id", path),
                "layer": "long-term",
                "record_type": "long-term-entry",
                "title": require_string(entry, "title", path),
                "summary": compact_text(content),
                "path": project_relative(project_root, path),
                "locator": require_string(entry, "entry_id", path),
                "status": entry.get("status", "active"),
                "memory_kind": require_string(entry, "memory_kind", path),
                "tags": optional_string_list(entry, "tags", path),
                "aliases": optional_string_list(entry, "aliases", path),
                "search_hints": [],
                "updated_at": updated_at,
            }
        )
    return result


def temporary_index_entries(project_root: Path, source_files: set[Path]) -> list[dict[str, Any]]:
    active_root = project_root / ".maestro/memory/temporary/active"
    if not active_root.is_dir():
        return []
    result: list[dict[str, Any]] = []
    for directory in sorted(path for path in active_root.iterdir() if path.is_dir()):
        meta_path = directory / "meta.yaml"
        if not meta_path.is_file():
            raise CatalogError(f"{directory}: active Temporary is missing meta.yaml")
        meta = parse_simple_yaml(meta_path)
        temporary_id = require_string(meta, "id", meta_path)
        if temporary_id != directory.name:
            raise CatalogError(f"{meta_path}: id must match directory name '{directory.name}'")
        if require_string(meta, "status", meta_path) != "active":
            raise CatalogError(f"{meta_path}: active Temporary must have status 'active'")
        topic = require_string(meta, "topic", meta_path)
        aliases = optional_string_list(meta, "aliases", meta_path)
        current_path = directory / "current.md"
        current = read_optional(current_path)
        goals = section_values(current, ("Current goal", "Goal"))
        hints = section_values(current, ("Confirmed", "Open questions"))
        detail_path = current_path if current_path.is_file() else meta_path
        source_files.add(meta_path)
        if current_path.is_file():
            source_files.add(current_path)
        updated_at = meta.get("updated_at") if isinstance(meta.get("updated_at"), str) else None
        result.append(
            {
                "memory_id": temporary_id,
                "layer": "temporary",
                "record_type": "temporary",
                "title": topic,
                "summary": goals[0] if goals else topic,
                "path": project_relative(project_root, detail_path),
                "locator": "routing-context",
                "status": "active",
                "memory_kind": None,
                "tags": [],
                "aliases": aliases,
                "search_hints": hints,
                "updated_at": updated_at,
            }
        )
    return result


def current_state_entries(
    project_root: Path,
    task_directory: Path,
    task_id: str,
    task_title: str,
    source_files: set[Path],
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for collection, record_type in (("roles", "role-state"), ("workers", "worker-state")):
        root = task_directory / collection
        if not root.is_dir():
            continue
        for unit in sorted(path for path in root.iterdir() if path.is_dir()):
            state_path = unit / "current-state.md"
            if not state_path.is_file():
                continue
            state = read_optional(state_path)
            objective = section_values(state, ("Objective", "Current goal"))
            findings = section_values(
                state,
                ("Key findings", "Work done", "Open items", "Recommended next"),
            )
            summary = objective[0] if objective else (
                findings[0] if findings else f"{unit.name} current state"
            )
            source_files.add(state_path)
            result.append(
                {
                    "memory_id": f"{task_id}.{record_type}.{unit.name}",
                    "layer": "task",
                    "record_type": record_type,
                    "title": f"{task_title} / {unit.name}",
                    "summary": summary,
                    "path": project_relative(project_root, state_path),
                    "locator": "current-state",
                    "status": "active",
                    "memory_kind": None,
                    "tags": [],
                    "aliases": [],
                    "search_hints": findings,
                    "updated_at": None,
                }
            )
    return result


def task_index_entries(project_root: Path, source_files: set[Path]) -> list[dict[str, Any]]:
    tasks_root = project_root / ".maestro/tasks"
    if not tasks_root.is_dir():
        return []
    result: list[dict[str, Any]] = []
    directories = sorted(
        path
        for path in tasks_root.iterdir()
        if path.is_dir() and path.name != "archive"
    )
    for directory in directories:
        task_path = directory / "task.yaml"
        if not task_path.is_file():
            continue
        task = parse_simple_yaml(task_path)
        if task.get("status") != "active":
            continue
        task_id = require_string(task, "id", task_path)
        if task_id != directory.name:
            raise CatalogError(f"{task_path}: id must match directory name '{directory.name}'")
        objective = require_string(task, "objective", task_path)
        context_path = directory / "context.md"
        context = read_optional(context_path)
        hints = section_values(
            context,
            ("Confirmed", "Open questions", "Open items", "Current state"),
        )
        detail_path = context_path if context_path.is_file() else task_path
        source_files.add(task_path)
        if context_path.is_file():
            source_files.add(context_path)
        updated_at = task.get("updated_at") if isinstance(task.get("updated_at"), str) else None
        result.append(
            {
                "memory_id": task_id,
                "layer": "task",
                "record_type": "task",
                "title": objective,
                "summary": objective,
                "path": project_relative(project_root, detail_path),
                "locator": "task-context",
                "status": "active",
                "memory_kind": None,
                "tags": [],
                "aliases": [],
                "search_hints": hints,
                "updated_at": updated_at,
            }
        )
        result.extend(
            current_state_entries(
                project_root,
                directory,
                task_id,
                objective,
                source_files,
            )
        )
    return result


def digest_sources(project_root: Path, source_files: Iterable[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(set(source_files), key=lambda item: project_relative(project_root, item)):
        relative = project_relative(project_root, path)
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        try:
            digest.update(path.read_bytes())
        except OSError as error:
            raise CatalogError(f"cannot hash {path}: {error}") from error
        digest.update(b"\0")
    return digest.hexdigest()


def validate_index(index: dict[str, Any], project_root: Path) -> None:
    errors: list[Diagnostic] = []
    validate_memory_index(index, errors, FileReferenceValidator(project_root))
    if errors:
        details = "; ".join(f"{error.path}: {error.message}" for error in errors)
        raise CatalogError(f"generated Memory Index is invalid: {details}")


def derive_catalog(project_root: Path) -> dict[str, Any]:
    source_files: set[Path] = set()
    entries = []
    entries.extend(long_term_index_entries(project_root, source_files))
    entries.extend(temporary_index_entries(project_root, source_files))
    entries.extend(task_index_entries(project_root, source_files))
    entries.sort(key=lambda item: (item["layer"], item["record_type"], item["memory_id"]))
    seen: set[str] = set()
    for entry in entries:
        memory_id = entry["memory_id"]
        if memory_id in seen:
            raise CatalogError(f"duplicate memory_id across layers: '{memory_id}'")
        seen.add(memory_id)
    index = {
        "schema_version": 1,
        "generated_at": utc_now(),
        "source_digest": digest_sources(project_root, source_files),
        "entries": entries,
    }
    validate_index(index, project_root)
    return index


def manifest_text(index: dict[str, Any]) -> str:
    visible = [entry for entry in index["entries"] if entry["status"] == "active"]
    groups = (
        (
            "Active Temporary Memory",
            [entry for entry in visible if entry["record_type"] == "temporary"],
        ),
        ("Active Tasks", [entry for entry in visible if entry["record_type"] == "task"]),
        (
            "Long-term Memory",
            [entry for entry in visible if entry["record_type"] == "long-term-entry"],
        ),
    )
    lines = [
        "---",
        "schema_version: 1",
        f"generated_at: {index['generated_at']}",
        f"source_digest: {index['source_digest']}",
        "---",
        "",
        "# Memory Overview",
        "",
        "This file is generated. Formal Memory files remain authoritative.",
    ]
    for title, entries in groups:
        lines.extend(("", f"## {title}", ""))
        if not entries:
            lines.append("- None")
            continue
        for entry in entries:
            lines.append(f"- **{entry['title']}** (`{entry['memory_id']}`) — {entry['summary']}")
    state_count = sum(entry["record_type"] in {"role-state", "worker-state"} for entry in visible)
    lines.extend(
        (
            "",
            "## Indexed execution states",
            "",
            f"- {state_count} current role/worker state(s)",
            "",
        )
    )
    return "\n".join(lines)


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


def persist_catalog(project_root: Path, index: dict[str, Any]) -> None:
    atomic_write(
        project_root / INDEX_PATH,
        json.dumps(index, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )
    atomic_write(project_root / MANIFEST_PATH, manifest_text(index))


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
    try:
        validate_index(value, project_root)
    except CatalogError:
        return None
    return value


def entries_equal(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return (
        left.get("source_digest") == right.get("source_digest")
        and left.get("entries") == right.get("entries")
    )


def manifest_is_current(project_root: Path, index: dict[str, Any]) -> bool:
    path = project_root / MANIFEST_PATH
    if not path.is_file():
        return False
    return read_optional(path) == manifest_text(index)


def ensure_current_index(project_root: Path, *, refresh: bool) -> tuple[dict[str, Any], bool]:
    expected = derive_catalog(project_root)
    current = load_index(project_root)
    stale = (
        current is None
        or not entries_equal(current, expected)
        or not manifest_is_current(project_root, current)
    )
    if stale:
        if not refresh:
            raise CatalogError("Memory catalog is missing or stale; run the build command")
        persist_catalog(project_root, expected)
        return expected, True
    return current, False


def search_tokens(value: str) -> set[str]:
    normalized = value.casefold()
    tokens = set(LATIN_TOKEN.findall(normalized))
    for run in CJK_RUN.findall(normalized):
        tokens.add(run)
        if len(run) > 1:
            tokens.update(run[index : index + 2] for index in range(len(run) - 1))
    return {token for token in tokens if token}


def field_score(
    query: str,
    query_tokens: set[str],
    values: Iterable[str],
    exact: int,
    token: int,
) -> tuple[int, bool]:
    score = 0
    matched = False
    for value in values:
        normalized = value.casefold()
        if query and query in normalized:
            score += exact
            matched = True
        overlap = query_tokens & search_tokens(normalized)
        if overlap:
            score += min(len(overlap), 5) * token
            matched = True
    return score, matched


def rank_entry(
    entry: dict[str, Any],
    query: str,
    contexts: list[str],
    binding: str | None,
) -> tuple[int, list[str]]:
    normalized_query = " ".join((query, *contexts)).casefold().strip()
    tokens = search_tokens(normalized_query)
    score = 0
    reasons: list[str] = []
    if binding and entry["memory_id"] == binding:
        score += 100
        reasons.append("current binding")
    for label, values, exact, token in (
        ("title", [entry["title"]], 30, 8),
        ("summary", [entry["summary"]], 20, 4),
        ("tag", entry["tags"], 25, 7),
        ("alias", entry["aliases"], 25, 7),
        ("current state", entry["search_hints"], 10, 2),
    ):
        added, matched = field_score(normalized_query, tokens, values, exact, token)
        score += added
        if matched:
            reasons.append(label)
    return score, reasons


def search_index(
    index: dict[str, Any],
    query: str,
    *,
    layer: str | None,
    memory_kind: str | None,
    contexts: list[str],
    binding: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for entry in index["entries"]:
        if entry["status"] not in ACTIVE_STATUSES:
            continue
        if layer and entry["layer"] != layer:
            continue
        if memory_kind and entry["memory_kind"] != memory_kind:
            continue
        score, reasons = rank_entry(entry, query, contexts, binding)
        if score <= 0:
            continue
        candidate = dict(entry)
        candidate["score"] = score
        candidate["relevance_reason"] = ", ".join(reasons)
        candidate.pop("search_hints", None)
        candidates.append(candidate)
    candidates.sort(key=lambda item: (-item["score"], item["memory_id"]))
    return candidates[:limit]


def detail_for_entry(project_root: Path, entry: dict[str, Any]) -> dict[str, Any]:
    path = project_root / Path(entry["path"])
    record_type = entry["record_type"]
    if record_type == "long-term-entry":
        match = next(
            (
                candidate
                for candidate in parse_long_term_entries(path)
                if candidate.get("entry_id") == entry["locator"]
            ),
            None,
        )
        if match is None:
            raise CatalogError(f"Long-term entry '{entry['memory_id']}' is no longer present")
        return match
    text = read_optional(path)
    if path.suffix in {".yaml", ".yml"}:
        return parse_simple_yaml(path)
    sections = markdown_sections(text)
    if record_type == "temporary":
        names = (
            "topic",
            "current goal",
            "confirmed",
            "rejected",
            "open questions",
            "history references",
        )
    elif record_type == "task":
        names = (
            "objective",
            "current goal",
            "confirmed",
            "open questions",
            "open items",
            "current state",
        )
    else:
        names = (
            "objective",
            "work done",
            "key findings",
            "important paths",
            "open items",
            "recommended next",
            "history refs",
        )
    selected = {name: sections[name] for name in names if name in sections and sections[name]}
    return selected or {"content": compact_text(strip_front_matter(text), 2000)}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Maintain Maestro's derived Memory catalog.")
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("build")
    subparsers.add_parser("check")

    search = subparsers.add_parser("search")
    search.add_argument("query")
    search.add_argument("--layer", choices=("temporary", "task", "long-term"))
    search.add_argument("--memory-kind", choices=sorted(LONG_TERM_KINDS))
    search.add_argument("--context", action="append", default=[])
    search.add_argument("--binding")
    search.add_argument("--limit", type=int, default=5)
    search.add_argument("--no-refresh", action="store_true")

    show = subparsers.add_parser("show")
    show.add_argument("memory_id")
    show.add_argument("--include-inactive", action="store_true")
    show.add_argument("--no-refresh", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        project_root = args.project_root.resolve(strict=True)
        if not project_root.is_dir():
            raise CatalogError(f"project root is not a directory: {project_root}")
        if args.command == "build":
            index = derive_catalog(project_root)
            persist_catalog(project_root, index)
            print(json.dumps({"status": "built", "entries": len(index["entries"])}, sort_keys=True))
            return 0
        if args.command == "check":
            expected = derive_catalog(project_root)
            current = load_index(project_root)
            if (
                current is None
                or not entries_equal(current, expected)
                or not manifest_is_current(project_root, current)
            ):
                print("Memory catalog is missing or stale", file=sys.stderr)
                return 1
            print(
                json.dumps(
                    {"status": "current", "entries": len(current["entries"])},
                    sort_keys=True,
                )
            )
            return 0
        index, refreshed = ensure_current_index(project_root, refresh=not args.no_refresh)
        if args.command == "search":
            if args.limit < 1 or args.limit > 5:
                raise CatalogError("--limit must be between 1 and 5")
            candidates = search_index(
                index,
                args.query,
                layer=args.layer,
                memory_kind=args.memory_kind,
                contexts=args.context,
                binding=args.binding,
                limit=args.limit,
            )
            print(
                json.dumps(
                    {
                        "query": args.query,
                        "contexts": args.context,
                        "catalog_refreshed": refreshed,
                        "candidates": candidates,
                    },
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
            )
            return 0
        entry = next(
            (
                item
                for item in index["entries"]
                if item["memory_id"] == args.memory_id
            ),
            None,
        )
        if entry is None or (entry["status"] != "active" and not args.include_inactive):
            raise CatalogError(f"Memory '{args.memory_id}' is unavailable")
        print(
            json.dumps(
                {
                    "memory": entry,
                    "detail": detail_for_entry(project_root, entry),
                    "catalog_refreshed": refreshed,
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
        )
        return 0
    except (CatalogError, OSError, RuntimeError, ValueError) as error:
        print(f"memory catalog error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
