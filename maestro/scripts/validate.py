#!/usr/bin/env python3
"""Validate persisted Maestro protocol artifacts without changing workflow state."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Callable


Validator = Callable[[Any, str, list["Diagnostic"]], None]
CAPABILITY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
WINDOWS_DRIVE_PATTERN = re.compile(r"^[A-Za-z]:")


@dataclass(frozen=True)
class Diagnostic:
    path: str
    message: str


class NonStandardJsonConstant(ValueError):
    def __init__(self, constant: str):
        super().__init__(constant)
        self.constant = constant


def reject_non_standard_json_constant(constant: str) -> None:
    raise NonStandardJsonConstant(constant)


def add_error(errors: list[Diagnostic], path: str, message: str) -> None:
    errors.append(Diagnostic(path, message))


def is_object(value: Any) -> bool:
    return isinstance(value, dict)


def is_array(value: Any) -> bool:
    return isinstance(value, list)


def is_boolean(value: Any) -> bool:
    return isinstance(value, bool)


def require_object(value: Any, path: str, errors: list[Diagnostic]) -> bool:
    if not is_object(value):
        add_error(errors, path, "must be an object")
        return False
    return True


def check_object_shape(
    value: dict[str, Any],
    path: str,
    errors: list[Diagnostic],
    *,
    required: set[str],
    allowed: set[str],
) -> None:
    for key in sorted(required - value.keys()):
        add_error(errors, f"{path}.{key}", "is required")
    for key in sorted(value.keys() - allowed):
        add_error(errors, f"{path}.{key}", "is not allowed")


def check_string(
    value: Any,
    path: str,
    errors: list[Diagnostic],
    *,
    min_length: int = 0,
) -> bool:
    if not isinstance(value, str):
        add_error(errors, path, "must be a string")
        return False
    if len(value) < min_length:
        add_error(errors, path, f"must contain at least {min_length} character(s)")
        return False
    return True


def check_boolean(value: Any, path: str, errors: list[Diagnostic]) -> bool:
    if not is_boolean(value):
        add_error(errors, path, "must be a boolean")
        return False
    return True


def check_enum(
    value: Any, path: str, errors: list[Diagnostic], choices: set[str]
) -> bool:
    if not isinstance(value, str) or value not in choices:
        add_error(errors, path, f"must be one of: {', '.join(sorted(choices))}")
        return False
    return True


def check_array(
    value: Any,
    path: str,
    errors: list[Diagnostic],
    item_validator: Validator,
    *,
    min_items: int = 0,
) -> bool:
    if not is_array(value):
        add_error(errors, path, "must be an array")
        return False
    if len(value) < min_items:
        add_error(errors, path, f"must contain at least {min_items} item(s)")
    for index, item in enumerate(value):
        item_validator(item, f"{path}[{index}]", errors)
    return True


def check_plain_object(value: Any, path: str, errors: list[Diagnostic]) -> None:
    require_object(value, path, errors)


def make_string_validator(*, min_length: int = 0) -> Validator:
    def validate(value: Any, path: str, errors: list[Diagnostic]) -> None:
        check_string(value, path, errors, min_length=min_length)

    return validate


class FileReferenceValidator:
    def __init__(self, project_root: Path):
        self.project_root = project_root.resolve(strict=True)

    def __call__(self, value: Any, path: str, errors: list[Diagnostic]) -> None:
        if not check_string(value, path, errors, min_length=1):
            return

        assert isinstance(value, str)
        if "\\" in value:
            add_error(errors, path, "must use '/' separators")
            return
        if value.startswith("/") or WINDOWS_DRIVE_PATTERN.match(value):
            add_error(errors, path, "must be project-relative")
            return
        if any(ord(character) < 32 for character in value):
            add_error(errors, path, "must not contain control characters")
            return

        pure_path = PurePosixPath(value)
        if any(part in {"", ".", ".."} for part in value.split("/")):
            add_error(errors, path, "must not contain empty, '.' or '..' segments")
            return
        if pure_path.is_absolute():
            add_error(errors, path, "must be project-relative")
            return

        try:
            resolved = (self.project_root / Path(*pure_path.parts)).resolve(strict=False)
        except (OSError, RuntimeError, ValueError) as error:
            add_error(errors, path, f"cannot resolve file reference: {error}")
            return
        try:
            resolved.relative_to(self.project_root)
        except ValueError:
            add_error(errors, path, "resolves outside the project root")
            return
        try:
            is_file = resolved.is_file()
        except (OSError, ValueError) as error:
            add_error(errors, path, f"cannot inspect file reference: {error}")
            return
        if not is_file:
            add_error(errors, path, "must reference an existing file")


def validate_question(value: Any, path: str, errors: list[Diagnostic]) -> None:
    if not require_object(value, path, errors):
        return
    check_object_shape(
        value,
        path,
        errors,
        required={"question", "reason"},
        allowed={"question", "reason"},
    )
    for key in ("question", "reason"):
        if key in value:
            check_string(value[key], f"{path}.{key}", errors, min_length=1)


def validate_recommended_next(value: Any, path: str, errors: list[Diagnostic]) -> None:
    if not require_object(value, path, errors):
        return

    has_role = "role" in value
    has_capabilities = "capabilities" in value
    if has_role == has_capabilities:
        add_error(errors, path, "must contain exactly one of 'role' or 'capabilities'")

    allowed = {"role", "reason"} if has_role and not has_capabilities else {
        "capabilities",
        "reason",
    }
    required = allowed
    check_object_shape(value, path, errors, required=required, allowed=allowed)

    if "role" in value:
        check_string(value["role"], f"{path}.role", errors, min_length=1)
    if "reason" in value:
        check_string(value["reason"], f"{path}.reason", errors, min_length=1)
    if "capabilities" in value:
        capabilities = value["capabilities"]
        if check_array(
            capabilities,
            f"{path}.capabilities",
            errors,
            make_string_validator(min_length=1),
            min_items=1,
        ):
            seen: set[str] = set()
            for index, capability in enumerate(capabilities):
                if not isinstance(capability, str):
                    continue
                if capability in seen:
                    add_error(
                        errors,
                        f"{path}.capabilities[{index}]",
                        "must be unique",
                    )
                seen.add(capability)
                if not CAPABILITY_PATTERN.fullmatch(capability):
                    add_error(
                        errors,
                        f"{path}.capabilities[{index}]",
                        "must use canonical kebab-case",
                    )


def validate_handoff(
    value: Any, errors: list[Diagnostic], file_reference: FileReferenceValidator
) -> None:
    path = "$"
    if not require_object(value, path, errors):
        return
    required = {
        "status",
        "summary",
        "result_path",
        "needs_user_input",
        "recommended_next",
    }
    allowed = required | {
        "role_state_path",
        "worker_state_path",
        "questions",
    }
    check_object_shape(value, path, errors, required=required, allowed=allowed)

    if "status" in value:
        check_enum(
            value["status"],
            "$.status",
            errors,
            {"completed", "blocked", "failed", "cancelled"},
        )
    if "summary" in value:
        check_string(value["summary"], "$.summary", errors, min_length=1)
    for key in ("result_path", "role_state_path", "worker_state_path"):
        if key in value:
            file_reference(value[key], f"$.{key}", errors)
    if "needs_user_input" in value:
        check_boolean(value["needs_user_input"], "$.needs_user_input", errors)
    if "questions" in value:
        check_array(value["questions"], "$.questions", errors, validate_question)
    if "recommended_next" in value:
        check_array(
            value["recommended_next"],
            "$.recommended_next",
            errors,
            validate_recommended_next,
        )

    state_paths = [key for key in ("role_state_path", "worker_state_path") if key in value]
    if len(state_paths) != 1:
        add_error(errors, "$", "must contain exactly one role_state_path or worker_state_path")

    if value.get("needs_user_input") is True:
        if value.get("status") != "blocked":
            add_error(errors, "$.status", "must be 'blocked' when user input is needed")
        questions = value.get("questions")
        if not is_array(questions) or len(questions) == 0:
            add_error(errors, "$.questions", "must contain at least one question")
    elif is_array(value.get("questions")) and len(value["questions"]) > 0:
        add_error(errors, "$.questions", "must be empty when user input is not needed")


def validate_memory_request(
    value: Any, errors: list[Diagnostic], file_reference: FileReferenceValidator
) -> None:
    path = "$"
    if not require_object(value, path, errors):
        return
    required = {"operation", "source_files", "current_memory", "memory_hints"}
    allowed = required | {"task_context", "source_content"}
    check_object_shape(value, path, errors, required=required, allowed=allowed)

    if "operation" in value:
        check_enum(
            value["operation"],
            "$.operation",
            errors,
            {"role-compress", "session-handoff", "task-bootstrap", "task-complete"},
        )
    if "source_files" in value:
        check_array(
            value["source_files"],
            "$.source_files",
            errors,
            file_reference,
            min_items=1,
        )
    for key in ("current_memory", "memory_hints", "task_context", "source_content"):
        if key in value:
            check_plain_object(value[key], f"$.{key}", errors)


def validate_memory_item(
    value: Any,
    path: str,
    errors: list[Diagnostic],
    file_reference: FileReferenceValidator,
    *,
    content_min_length: int,
) -> None:
    if not require_object(value, path, errors):
        return
    required = {"title", "content", "source_refs"}
    check_object_shape(value, path, errors, required=required, allowed=required)
    if "title" in value:
        check_string(value["title"], f"{path}.title", errors, min_length=1)
    if "content" in value:
        check_string(
            value["content"],
            f"{path}.content",
            errors,
            min_length=content_min_length,
        )
    if "source_refs" in value:
        check_array(
            value["source_refs"],
            f"{path}.source_refs",
            errors,
            file_reference,
            min_items=1,
        )


def validate_memory_response(
    value: Any, errors: list[Diagnostic], file_reference: FileReferenceValidator
) -> None:
    path = "$"
    if not require_object(value, path, errors):
        return
    required = {"status", "current"}
    allowed = required | {
        "references",
        "discarded",
        "long_term_candidates",
        "notes",
    }
    check_object_shape(value, path, errors, required=required, allowed=allowed)

    if "status" in value and value["status"] != "completed":
        add_error(errors, "$.status", "must equal 'completed'")
    if "current" in value:
        current = value["current"]
        if require_object(current, "$.current", errors):
            check_object_shape(
                current,
                "$.current",
                errors,
                required={"content"},
                allowed={"content"},
            )
            if "content" in current:
                check_plain_object(current["content"], "$.current.content", errors)
    if "references" in value:
        check_array(
            value["references"],
            "$.references",
            errors,
            lambda item, item_path, item_errors: validate_memory_item(
                item,
                item_path,
                item_errors,
                file_reference,
                content_min_length=0,
            ),
        )
    if "long_term_candidates" in value:
        check_array(
            value["long_term_candidates"],
            "$.long_term_candidates",
            errors,
            lambda item, item_path, item_errors: validate_memory_item(
                item,
                item_path,
                item_errors,
                file_reference,
                content_min_length=1,
            ),
        )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate a Maestro protocol artifact without changing workflow state."
    )
    parser.add_argument(
        "kind", choices=("handoff", "memory-request", "memory-response")
    )
    parser.add_argument("file", type=Path)
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument("--json", action="store_true", dest="json_output")
    return parser.parse_args(argv)


def emit_result(
    args: argparse.Namespace, errors: list[Diagnostic], *, output_file: Path
) -> None:
    if args.json_output:
        payload = {
            "valid": not errors,
            "kind": args.kind,
            "file": str(output_file),
            "errors": [asdict(error) for error in errors],
        }
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
        return

    if not errors:
        print(f"valid: {args.kind} {output_file}")
        return
    for error in errors:
        print(f"{error.path}: {error.message}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        project_root = args.project_root.resolve(strict=True)
        if not project_root.is_dir():
            raise NotADirectoryError(f"project root is not a directory: {project_root}")
        output_file = args.file.resolve(strict=True)
        raw = output_file.read_text(encoding="utf-8")
    except (OSError, RuntimeError, UnicodeError, ValueError) as error:
        print(f"validator error: {error}", file=sys.stderr)
        return 2

    try:
        value = json.loads(raw, parse_constant=reject_non_standard_json_constant)
    except json.JSONDecodeError as error:
        errors = [
            Diagnostic(
                "$",
                f"invalid JSON at line {error.lineno}, column {error.colno}: {error.msg}",
            )
        ]
        emit_result(args, errors, output_file=output_file)
        return 1
    except NonStandardJsonConstant as error:
        errors = [
            Diagnostic(
                "$",
                f"invalid JSON: non-standard constant '{error.constant}'",
            )
        ]
        emit_result(args, errors, output_file=output_file)
        return 1

    file_reference = FileReferenceValidator(project_root)
    errors: list[Diagnostic] = []
    if args.kind == "handoff":
        validate_handoff(value, errors, file_reference)
    elif args.kind == "memory-request":
        validate_memory_request(value, errors, file_reference)
    else:
        validate_memory_response(value, errors, file_reference)

    emit_result(args, errors, output_file=output_file)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
