import { parseDocument } from "yaml";

import type { ParsedTask, ParsedTaskGraph } from "./types.ts";

export class TaskGraphParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskGraphParseError";
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TaskGraphParseError(`${path} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new TaskGraphParseError(`${path} must be an array of non-empty strings`);
  }
  return [...value];
}

function attempts(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 3) {
    throw new TaskGraphParseError(`${path} must be an integer between 1 and 3`);
  }
  return value as number;
}

function rejectUnknownFields(record: UnknownRecord, allowed: readonly string[], path: string): void {
  for (const field of Object.keys(record)) {
    if (!allowed.includes(field)) {
      throw new TaskGraphParseError(`${path} contains unsupported field "${field}"`);
    }
  }
}

function parseTask(value: unknown, index: number): ParsedTask {
  const path = `tasks[${index}]`;
  if (!isRecord(value)) throw new TaskGraphParseError(`${path} must be a mapping`);

  rejectUnknownFields(value, ["id", "role", "description", "depends", "acceptance", "writes", "maxAttempts"], path);
  return {
    id: requireString(value.id, `${path}.id`),
    role: requireString(value.role, `${path}.role`),
    description: requireString(value.description, `${path}.description`),
    depends: value.depends === undefined ? [] : stringArray(value.depends, `${path}.depends`),
    acceptance: value.acceptance === undefined ? [] : stringArray(value.acceptance, `${path}.acceptance`),
    writes: value.writes === undefined ? [] : stringArray(value.writes, `${path}.writes`),
    maxAttempts: value.maxAttempts === undefined ? 3 : attempts(value.maxAttempts, `${path}.maxAttempts`),
  };
}

/** Parses data only. Validation of graph semantics is intentionally separate. */
export function parseTaskGraph(source: string): ParsedTaskGraph {
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    throw new TaskGraphParseError(`invalid YAML: ${document.errors[0]?.message ?? "unknown parse error"}`);
  }

  const root = document.toJS();
  if (!isRecord(root)) throw new TaskGraphParseError("task graph root must be a mapping");
  rejectUnknownFields(root, ["name", "tasks"], "task graph root");

  if (!Array.isArray(root.tasks)) throw new TaskGraphParseError("task graph root.tasks must be an array");
  const name = root.name === undefined ? "delivery" : requireString(root.name, "task graph root.name");

  return {
    name,
    tasks: root.tasks.map((task, index) => parseTask(task, index)),
  };
}
