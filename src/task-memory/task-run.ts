import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

import { compileTaskGraph } from "../dsh/compile-workflow.ts";
import type { DshWorkflowRequest } from "../dsh/workflow-contract.ts";
import {
  TASK_MEMORY_SCHEMA_VERSION,
  type MemoryExcerpt,
  type PersistedTaskContext,
  type PreparedRun,
  type RecordedRun,
  type StoredTask,
} from "./contracts.ts";
import { queryProjectMemory } from "./memory-store.ts";
import { runDirectory, runReceiptPath, runResultPath, taskLockPath } from "./paths.ts";
import { type Clock, loadTask, persistTask } from "./task-store.ts";
import { withTaskLock } from "../runtime/task-lock.ts";
import { loadRoleState, queryWiki, writeRoleState } from "../memory/three-layer-store.ts";
import type { RoleState, WikiExcerpt } from "../memory/contracts.ts";

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

export type RecoveredTaskState = {
  task: StoredTask;
  recovered: "none" | "prepared-run" | "recorded-result";
  runId?: string;
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
    || typeof value.text !== "string"
    || (value.sourceArtifactIds !== undefined && (!Array.isArray(value.sourceArtifactIds) || value.sourceArtifactIds.some((id) => typeof id !== "string")))
    || (value.createdAt !== undefined && typeof value.createdAt !== "string")) {
    throw new TaskRunConflictError(`${path} is not a valid memory excerpt`);
  }
  return {
    id: value.id,
    taskId: value.taskId,
    runId: value.runId,
    tags: [...value.tags],
    text: value.text,
    ...(Array.isArray(value.sourceArtifactIds) ? { sourceArtifactIds: [...value.sourceArtifactIds] as string[] } : {}),
    ...(typeof value.createdAt === "string" ? { createdAt: value.createdAt } : {}),
    ...(typeof value.scope === "string" ? { scope: value.scope as Exclude<MemoryExcerpt["scope"], undefined> } : {}),
    ...(typeof value.role === "string" ? { role: value.role } : {}),
    ...(typeof value.kind === "string" ? { kind: value.kind as Exclude<MemoryExcerpt["kind"], undefined> } : {}),
    ...(typeof value.status === "string" ? { status: value.status as Exclude<MemoryExcerpt["status"], undefined> } : {}),
  };
}

function parseWikiExcerpt(value: unknown, path: string): WikiExcerpt {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || !Number.isInteger(value.revision)
    || typeof value.title !== "string"
    || typeof value.body !== "string"
    || !Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string")
    || !Array.isArray(value.sourceMemoryIds) || value.sourceMemoryIds.some((id) => typeof id !== "string")
    || typeof value.updatedAt !== "string") {
    throw new TaskRunConflictError(`${path} is not a valid wiki excerpt`);
  }
  return value as unknown as WikiExcerpt;
}

function parseRoleState(value: unknown, path: string): RoleState {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.taskId !== "string"
    || typeof value.role !== "string"
    || typeof value.summary !== "string"
    || !Array.isArray(value.decisions) || value.decisions.some((item) => typeof item !== "string")
    || !Array.isArray(value.blockers) || value.blockers.some((item) => typeof item !== "string")
    || !Array.isArray(value.nextActions) || value.nextActions.some((item) => typeof item !== "string")
    || typeof value.updatedAt !== "string") {
    throw new TaskRunConflictError(`${path} is not a valid role state`);
  }
  return value as unknown as RoleState;
}

function parseTaskContext(value: unknown, task: StoredTask, runId: string): PersistedTaskContext {
  if (!isRecord(value)
    || value.taskId !== task.id
    || value.taskRevision !== task.revision
    || value.runId !== runId
    || !Array.isArray(value.memory)) {
    throw new TaskRunConflictError(`active run "${runId}" has an invalid persisted task context`);
  }
  let projectWiki: WikiExcerpt[] | undefined;
  if (value.projectWiki !== undefined) {
    if (!Array.isArray(value.projectWiki)) throw new TaskRunConflictError(`active run "${runId}" has invalid project wiki context`);
    projectWiki = value.projectWiki.map((entry, index) => parseWikiExcerpt(entry, `active run "${runId}" projectWiki[${index}]`));
  }
  let roleMemory: PersistedTaskContext["roleMemory"];
  if (value.roleMemory !== undefined) {
    if (!isRecord(value.roleMemory)) throw new TaskRunConflictError(`active run "${runId}" has invalid role memory context`);
    roleMemory = Object.fromEntries(Object.entries(value.roleMemory).map(([role, context]) => {
      if (!isRecord(context) || !Array.isArray(context.memory)) {
        throw new TaskRunConflictError(`active run "${runId}" roleMemory.${role} is invalid`);
      }
      return [role, {
        memory: context.memory.map((entry, index) => parseMemoryExcerpt(entry, `active run "${runId}" roleMemory.${role}.memory[${index}]`)),
        ...(context.state === undefined ? {} : { state: parseRoleState(context.state, `active run "${runId}" roleMemory.${role}.state`) }),
      }];
    }));
  }
  return {
    taskId: task.id,
    taskRevision: task.revision,
    runId,
    memory: value.memory.map((entry, index) => parseMemoryExcerpt(entry, `active run "${runId}" memory[${index}]`)),
    ...(projectWiki === undefined ? {} : { projectWiki }),
    ...(roleMemory === undefined ? {} : { roleMemory }),
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

async function missing(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return true;
    throw error;
  }
}

/** Recovers a receipt written before a crash that happened just before task.json was activated. */
async function recoverOrphanedRun(projectRoot: string, task: StoredTask): Promise<PreparedTaskRun | undefined> {
  let files: string[];
  try {
    files = await readdir(runDirectory(projectRoot, task.id));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  const candidates = files.filter((name) => /^run-[0-9]{6}\.json$/.test(name)).sort().reverse();
  for (const name of candidates) {
    const runId = name.slice(0, -".json".length);
    if (!(await missing(runResultPath(projectRoot, task.id, runId)))) continue;
    try {
      const activeTask: StoredTask = { ...task, status: "running", activeRunId: runId };
      const run = await loadPreparedRun(projectRoot, activeTask);
      await persistTask(projectRoot, { ...activeTask, updatedAt: run.preparedAt });
      return { task: activeTask, run, workflow: run.workflow };
    } catch (error) {
      if (!(error instanceof TaskRunConflictError)) throw error;
    }
  }
  return undefined;
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
  return withTaskLock(taskLockPath(options.projectRoot, options.taskId), async () => {
    const task = await loadTask({ projectRoot: options.projectRoot, taskId: options.taskId });
    if (task.activeRunId !== undefined) throw new TaskRunConflictError(`task "${options.taskId}" already has active run "${task.activeRunId}"`);
    if (task.status === "completed") throw new TaskRunConflictError(`task "${options.taskId}" is completed and must be revised before another run`);

    const recovered = await recoverOrphanedRun(options.projectRoot, task);
    if (recovered !== undefined) return recovered;

    const preparedAt = timestamp(options.clock);
    const runId = await nextRunId(options.projectRoot, options.taskId);
    const memoryQuery = [...(options.memoryQuery ?? [])];
    const memory = await queryProjectMemory({ projectRoot: options.projectRoot, queries: memoryQuery, taskId: task.id });
    const projectWiki = await queryWiki(options.projectRoot, memoryQuery);
    const roles = [...new Set(task.graph.tasks.map((node) => node.role))];
    const roleMemory = Object.fromEntries(await Promise.all(roles.map(async (role) => {
      const [state, selected] = await Promise.all([
        loadRoleState(options.projectRoot, task.id, role),
        queryProjectMemory({
          projectRoot: options.projectRoot,
          queries: memoryQuery,
          taskId: task.id,
          role,
          maximumCharacters: 3_000,
        }),
      ]);
      return [role, { memory: selected, ...(state === undefined ? {} : { state }) }];
    })));
    const taskContext: PersistedTaskContext = {
      taskId: task.id,
      taskRevision: task.revision,
      runId,
      memory,
      projectWiki,
      roleMemory,
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
    return { task: activeTask, run, workflow };
  });
}

/** Returns the exact persisted workflow request for an interrupted active run without mutating state. */
export async function resumeTaskRun(options: ResumeTaskRunOptions): Promise<PreparedTaskRun> {
  const task = await loadTask({ projectRoot: options.projectRoot, taskId: options.taskId });
  const run = await loadPreparedRun(options.projectRoot, task);
  return { task, run, workflow: run.workflow };
}

async function replayRecordedRoleStates(projectRoot: string, task: StoredTask, recorded: RecordedRun): Promise<void> {
  for (const node of task.graph.tasks) {
    const state = recorded.result.tasks[node.id]?.roleState;
    if (state === undefined) continue;
    await writeRoleState({
      projectRoot,
      state: {
        schemaVersion: 1,
        taskId: task.id,
        role: node.role,
        ...state,
        sourceRunId: recorded.id,
        updatedAt: recorded.recordedAt,
      },
    });
  }
}

/** Repairs the two crash windows using only project-owned receipts; no session state is consulted. */
export async function recoverTaskRunState(options: ResumeTaskRunOptions): Promise<RecoveredTaskState> {
  return withTaskLock(taskLockPath(options.projectRoot, options.taskId), async () => {
    const task = await loadTask({ projectRoot: options.projectRoot, taskId: options.taskId });
    if (task.activeRunId !== undefined) {
      const resultPath = runResultPath(options.projectRoot, task.id, task.activeRunId);
      if (!(await missing(resultPath))) {
        const recorded = JSON.parse(await readFile(resultPath, "utf8")) as RecordedRun;
        if (recorded.id !== task.activeRunId
          || recorded.taskId !== task.id
          || recorded.taskRevision !== task.revision
          || (recorded.status !== "completed" && recorded.status !== "blocked")
          || recorded.workflowDigest !== workflowDigest(recorded.workflow)) {
          throw new TaskRunConflictError(`recorded result "${task.activeRunId}" failed recovery validation`);
        }
        await replayRecordedRoleStates(options.projectRoot, task, recorded);
        const recoveredTask: StoredTask = { ...task, status: recorded.status, updatedAt: recorded.recordedAt };
        delete recoveredTask.activeRunId;
        await persistTask(options.projectRoot, recoveredTask);
        return { task: recoveredTask, recovered: "recorded-result", runId: recorded.id };
      }
      await loadPreparedRun(options.projectRoot, task);
      return { task, recovered: "none", runId: task.activeRunId };
    }
    if (task.status === "completed") return { task, recovered: "none" };
    const recovered = await recoverOrphanedRun(options.projectRoot, task);
    if (recovered === undefined) return { task, recovered: "none" };
    return { task: recovered.task, recovered: "prepared-run", runId: recovered.run.id };
  });
}
