import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { TASK_MEMORY_SCHEMA_VERSION, TASK_STATUS, type StoredTask } from "./contracts.ts";
import { taskDirectory, taskRecordPath } from "./paths.ts";
import type { TaskGraph } from "../task-graph/types.ts";
import { validateTaskGraph } from "../task-graph/validate.ts";

export type Clock = () => Date;

export type CreateTaskOptions = {
  projectRoot: string;
  taskId: string;
  graph: TaskGraph;
  clock?: Clock;
};

export type LoadTaskOptions = Pick<CreateTaskOptions, "projectRoot" | "taskId">;

export type ReviseTaskOptions = CreateTaskOptions;

export class TaskStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskStoreError";
  }
}

export class TaskAlreadyExistsError extends TaskStoreError {
  constructor(taskId: string) {
    super(`task "${taskId}" already exists`);
    this.name = "TaskAlreadyExistsError";
  }
}

export class TaskNotFoundError extends TaskStoreError {
  constructor(taskId: string) {
    super(`task "${taskId}" does not exist`);
    this.name = "TaskNotFoundError";
  }
}

export class TaskHasActiveRunError extends TaskStoreError {
  constructor(taskId: string) {
    super(`task "${taskId}" already has an active run`);
    this.name = "TaskHasActiveRunError";
  }
}

function now(clock: Clock | undefined): string {
  return (clock ?? (() => new Date()))().toISOString();
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requireProjectRoot(projectRoot: string): Promise<void> {
  try {
    const stat = await lstat(projectRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new TaskStoreError(`project root must be a real directory: ${projectRoot}`);
    }
  } catch (error) {
    if (isMissing(error)) {
      throw new TaskStoreError(`project root does not exist: ${projectRoot}`);
    }
    throw error;
  }
}

function normalizeGraph(graph: TaskGraph): TaskGraph {
  return validateTaskGraph(graph);
}

export function graphDigest(graph: TaskGraph): string {
  return createHash("sha256").update(JSON.stringify(graph)).digest("hex");
}

function parseStoredTask(value: unknown, taskId: string): StoredTask {
  if (!isRecord(value)
    || value.schemaVersion !== TASK_MEMORY_SCHEMA_VERSION
    || value.id !== taskId
    || typeof value.status !== "string"
    || !TASK_STATUS.includes(value.status as StoredTask["status"])
    || !Number.isInteger(value.revision) || (value.revision as number) < 1
    || typeof value.graphDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.graphDigest)
    || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string"
    || (value.activeRunId !== undefined && typeof value.activeRunId !== "string")) {
    throw new TaskStoreError(`task "${taskId}" has an invalid persisted record`);
  }

  try {
    const graph = normalizeGraph(value.graph as TaskGraph);
    return {
      schemaVersion: TASK_MEMORY_SCHEMA_VERSION,
      id: taskId,
      status: value.status as StoredTask["status"],
      revision: value.revision as number,
      graph,
      graphDigest: value.graphDigest,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      ...(typeof value.activeRunId === "string" ? { activeRunId: value.activeRunId } : {}),
    };
  } catch (error) {
    if (error instanceof TaskStoreError) throw error;
    throw new TaskStoreError(`task "${taskId}" has an invalid Task Graph`);
  }
}

async function writeJson(path: string, value: unknown, exclusive = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, exclusive ? { flag: "wx" } : undefined);
}

/** Writes a validated replacement record. It is for task-memory modules, not a general user input API. */
export async function persistTask(projectRoot: string, task: StoredTask): Promise<void> {
  await requireProjectRoot(projectRoot);
  const normalized = parseStoredTask(task, task.id);
  await writeJson(taskRecordPath(projectRoot, normalized.id), normalized);
}

/** Creates one task from an already validated graph and never overwrites an existing task. */
export async function createTask(options: CreateTaskOptions): Promise<StoredTask> {
  await requireProjectRoot(options.projectRoot);
  const graph = normalizeGraph(options.graph);
  const timestamp = now(options.clock);
  const task: StoredTask = {
    schemaVersion: TASK_MEMORY_SCHEMA_VERSION,
    id: options.taskId,
    status: "ready",
    revision: 1,
    graph,
    graphDigest: graphDigest(graph),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const recordPath = taskRecordPath(options.projectRoot, options.taskId);

  try {
    await mkdir(taskDirectory(options.projectRoot, options.taskId), { recursive: true });
    await writeJson(recordPath, task, true);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      throw new TaskAlreadyExistsError(options.taskId);
    }
    throw error;
  }
  return task;
}

export async function loadTask(options: LoadTaskOptions): Promise<StoredTask> {
  await requireProjectRoot(options.projectRoot);
  try {
    const source = await readFile(taskRecordPath(options.projectRoot, options.taskId), "utf8");
    return parseStoredTask(JSON.parse(source) as unknown, options.taskId);
  } catch (error) {
    if (isMissing(error)) throw new TaskNotFoundError(options.taskId);
    if (error instanceof SyntaxError) throw new TaskStoreError(`task "${options.taskId}" contains invalid JSON`);
    throw error;
  }
}

/** Revisions replace only the Task Graph and are forbidden once a run is active. */
export async function reviseTask(options: ReviseTaskOptions): Promise<StoredTask> {
  const current = await loadTask(options);
  if (current.activeRunId !== undefined) throw new TaskHasActiveRunError(options.taskId);

  const graph = normalizeGraph(options.graph);
  const revised: StoredTask = {
    ...current,
    status: "ready",
    revision: current.revision + 1,
    graph,
    graphDigest: graphDigest(graph),
    updatedAt: now(options.clock),
  };
  await persistTask(options.projectRoot, revised);
  return revised;
}
