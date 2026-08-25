import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

import { compileTaskGraph } from "../dsh/compile-workflow.ts";
import type { DshWorkflowRequest } from "../dsh/workflow-contract.ts";
import {
  TASK_MEMORY_SCHEMA_VERSION,
  type MemoryExcerpt,
  type PersistedTaskContext,
  type PreparedRun,
  type StoredTask,
} from "./contracts.ts";
import { queryProjectMemory } from "./memory-store.ts";
import { runDirectory, runReceiptPath } from "./paths.ts";
import { type Clock, loadTask, persistTask } from "./task-store.ts";

export type PrepareTaskRunOptions = {
  projectRoot: string;
  taskId: string;
  memoryQuery?: readonly string[];
  clock?: Clock;
};

export type PreparedTaskRun = {
  task: StoredTask;
  run: PreparedRun;
  workflow: DshWorkflowRequest;
};

export type ResumeTaskRunOptions = {
  projectRoot: string;
  taskId: string;
};

export class TaskRunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskRunConflictError";
  }
}

function timestamp(clock: Clock | undefined): string {
  return (clock ?? (() => new Date()))().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Gives a persisted workflow request an integrity marker for recovery and audit. */
export function workflowDigest(workflow: DshWorkflowRequest): string {
  return createHash("sha256").update(JSON.stringify(workflow)).digest("hex");
}

function parseMemoryExcerpt(value: unknown, path: string): MemoryExcerpt {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.taskId !== "string"
    || typeof value.runId !== "string"
    || !Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string")
    || typeof value.text !== "string") {
    throw new TaskRunConflictError(`${path} is not a valid memory excerpt`);
  }
  return {
    id: value.id,
    taskId: value.taskId,
    runId: value.runId,
    tags: [...value.tags],
    text: value.text,
  };
}

function parseTaskContext(value: unknown, task: StoredTask, runId: string): PersistedTaskContext {
  if (!isRecord(value)
    || value.taskId !== task.id
    || value.taskRevision !== task.revision
    || value.runId !== runId
    || !Array.isArray(value.memory)) {
    throw new TaskRunConflictError(`active run "${runId}" has an invalid persisted task context`);
  }
  return {
    taskId: task.id,
    taskRevision: task.revision,
    runId,
    memory: value.memory.map((entry, index) => parseMemoryExcerpt(entry, `active run "${runId}" memory[${index}]`)),
  };
}

function parseWorkflow(value: unknown, context: PersistedTaskContext, runId: string): DshWorkflowRequest {
  if (!isRecord(value) || typeof value.script !== "string" || !isRecord(value.meta) || !isRecord(value.args)) {
    throw new TaskRunConflictError(`active run "${runId}" has an invalid persisted workflow request`);
  }
  if (JSON.stringify(value.args.taskContext) !== JSON.stringify(context)) {
    throw new TaskRunConflictError(`active run "${runId}" workflow context does not match its receipt`);
  }
  return value as unknown as DshWorkflowRequest;
}

async function nextRunId(projectRoot: string, taskId: string): Promise<string> {
  let files: string[];
  try {
    files = await readdir(runDirectory(projectRoot, taskId));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return "run-000001";
    }
    throw error;
  }
  const numbers = files.flatMap((name) => {
    const match = /^run-([0-9]{6})\.json$/.exec(name);
    return match?.[1] === undefined ? [] : [Number.parseInt(match[1], 10)];
  });
  const next = Math.max(0, ...numbers) + 1;
  if (next > 999_999) throw new TaskRunConflictError(`task "${taskId}" has exhausted run identifiers`);
  return `run-${String(next).padStart(6, "0")}`;
}

async function writePreparedRun(projectRoot: string, taskId: string, run: PreparedRun): Promise<void> {
  const path = runReceiptPath(projectRoot, taskId, run.id);
  await mkdir(runDirectory(projectRoot, taskId), { recursive: true });
  await writeFile(path, `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
}

/** Loads and integrity-checks the currently active, not-yet-recorded run. */
export async function loadPreparedRun(projectRoot: string, task: StoredTask): Promise<PreparedRun> {
  if (task.activeRunId === undefined) throw new TaskRunConflictError(`task "${task.id}" has no active run to resume`);
  const runId = task.activeRunId;
  let value: unknown;
  try {
    value = JSON.parse(await readFile(runReceiptPath(projectRoot, task.id, runId), "utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new TaskRunConflictError(`active run "${runId}" contains invalid JSON`);
    throw error;
  }
  if (!isRecord(value)
    || value.schemaVersion !== TASK_MEMORY_SCHEMA_VERSION
    || value.id !== runId
    || value.taskId !== task.id
    || value.taskRevision !== task.revision
    || value.status !== "running"
    || typeof value.preparedAt !== "string"
    || !Array.isArray(value.memoryQuery) || value.memoryQuery.some((query) => typeof query !== "string")
    || typeof value.workflowDigest !== "string") {
    throw new TaskRunConflictError(`active run "${runId}" is not a valid running receipt`);
  }
  const taskContext = parseTaskContext(value.taskContext, task, runId);
  const workflow = parseWorkflow(value.workflow, taskContext, runId);
  if (workflowDigest(workflow) !== value.workflowDigest) {
    throw new TaskRunConflictError(`active run "${runId}" workflow digest does not match its receipt`);
  }
  return {
    schemaVersion: TASK_MEMORY_SCHEMA_VERSION,
    id: runId,
    taskId: task.id,
    taskRevision: task.revision,
    status: "running",
    preparedAt: value.preparedAt,
    memoryQuery: [...value.memoryQuery],
    taskContext,
    workflow,
    workflowDigest: value.workflowDigest,
  };
}

/** Persists one active run before returning its compile-only DSH Workflow request. */
export async function prepareTaskRun(options: PrepareTaskRunOptions): Promise<PreparedTaskRun> {
  const task = await loadTask({ projectRoot: options.projectRoot, taskId: options.taskId });
  if (task.activeRunId !== undefined) throw new TaskRunConflictError(`task "${options.taskId}" already has active run "${task.activeRunId}"`);
  if (task.status === "completed") throw new TaskRunConflictError(`task "${options.taskId}" is completed and must be revised before another run`);

  const preparedAt = timestamp(options.clock);
  const runId = await nextRunId(options.projectRoot, options.taskId);
  const memoryQuery = [...(options.memoryQuery ?? [])];
  const memory = await queryProjectMemory({ projectRoot: options.projectRoot, queries: memoryQuery });
  const taskContext: PersistedTaskContext = {
    taskId: task.id,
    taskRevision: task.revision,
    runId,
    memory,
  };
  const workflow = compileTaskGraph(task.graph, { taskContext });
  const run: PreparedRun = {
    schemaVersion: 1,
    id: runId,
    taskId: options.taskId,
    taskRevision: task.revision,
    status: "running",
    preparedAt,
    memoryQuery,
    taskContext,
    workflow,
    workflowDigest: workflowDigest(workflow),
  };
  const activeTask: StoredTask = {
    ...task,
    status: "running",
    activeRunId: runId,
    updatedAt: preparedAt,
  };

  await writePreparedRun(options.projectRoot, options.taskId, run);
  try {
    await persistTask(options.projectRoot, activeTask);
  } catch (error) {
    await rm(runReceiptPath(options.projectRoot, options.taskId, runId), { force: true });
    throw error;
  }
  return {
    task: activeTask,
    run,
    workflow,
  };
}

/** Returns the exact persisted workflow request for an interrupted active run without mutating state. */
export async function resumeTaskRun(options: ResumeTaskRunOptions): Promise<PreparedTaskRun> {
  const task = await loadTask({ projectRoot: options.projectRoot, taskId: options.taskId });
  const run = await loadPreparedRun(options.projectRoot, task);
  return { task, run, workflow: run.workflow };
}
