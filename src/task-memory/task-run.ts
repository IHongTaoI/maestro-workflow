import { mkdir, readdir, rm, writeFile } from "node:fs/promises";

import { compileTaskGraph } from "../dsh/compile-workflow.ts";
import type { DshWorkflowRequest } from "../dsh/workflow-contract.ts";
import type { PreparedRun, StoredTask } from "./contracts.ts";
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

export class TaskRunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskRunConflictError";
  }
}

function timestamp(clock: Clock | undefined): string {
  return (clock ?? (() => new Date()))().toISOString();
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

/** Persists one active run before returning its compile-only DSH Workflow request. */
export async function prepareTaskRun(options: PrepareTaskRunOptions): Promise<PreparedTaskRun> {
  const task = await loadTask({ projectRoot: options.projectRoot, taskId: options.taskId });
  if (task.activeRunId !== undefined) throw new TaskRunConflictError(`task "${options.taskId}" already has active run "${task.activeRunId}"`);
  if (task.status === "completed") throw new TaskRunConflictError(`task "${options.taskId}" is completed and must be revised before another run`);

  const preparedAt = timestamp(options.clock);
  const runId = await nextRunId(options.projectRoot, options.taskId);
  const memoryQuery = [...(options.memoryQuery ?? [])];
  const memory = await queryProjectMemory({ projectRoot: options.projectRoot, queries: memoryQuery });
  const run: PreparedRun = {
    schemaVersion: 1,
    id: runId,
    taskId: options.taskId,
    taskRevision: task.revision,
    status: "running",
    preparedAt,
    memoryQuery,
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
    workflow: compileTaskGraph(task.graph, {
      taskContext: { taskId: task.id, taskRevision: task.revision, runId, memory },
    }),
  };
}
