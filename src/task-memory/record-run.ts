import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import {
  TASK_MEMORY_SCHEMA_VERSION,
  type ArtifactRecord,
  type MemoryEntry,
  type PreparedRun,
  type RecordedRun,
  type StoredTask,
  type TaskResult,
  type WorkflowResult,
} from "./contracts.ts";
import { writeMemoryEntry } from "./memory-store.ts";
import { artifactContentPath, artifactDirectory, artifactMetadataPath, runCommitPath, runResultPath, taskLockPath } from "./paths.ts";
import { loadPreparedRun, TaskRunConflictError } from "./task-run.ts";
import { type Clock, loadTask, persistTask } from "./task-store.ts";
import { atomicCreateJson } from "../runtime/atomic.ts";
import { assertProjectContainedPath, normalizeProjectRelativePath, ProjectPathError } from "../runtime/project-path.ts";
import { withTaskLock } from "../runtime/task-lock.ts";
import { writeRoleState } from "../memory/three-layer-store.ts";

const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_MEMORY_ENTRY_CHARACTERS = 12_000;

export type RecordTaskRunOptions = {
  projectRoot: string;
  taskId: string;
  result: unknown;
  clock?: Clock;
};

export type RecordedTaskRun = {
  task: StoredTask;
  run: RecordedRun;
  artifacts: ArtifactRecord[];
  memory: MemoryEntry;
};

export class TaskRunRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskRunRecordError";
  }
}

type SnapshotInput = {
  record: ArtifactRecord;
  contents: Buffer;
};

function timestamp(clock: Clock | undefined): string {
  return (clock ?? (() => new Date()))().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new TaskRunRecordError(`${path} must be a string`);
  return value;
}

function exactFields(record: Record<string, unknown>, fields: readonly string[], path: string): void {
  if (Object.keys(record).some((field) => !fields.includes(field))) {
    throw new TaskRunRecordError(`${path} contains unsupported fields`);
  }
}

function parseTaskResult(value: unknown, taskId: string): TaskResult {
  if (!isRecord(value)) throw new TaskRunRecordError(`result.tasks.${taskId} must be an object`);
  exactFields(value, ["summary", "artifacts", "blockers", "needsUserInput", "needsDelegation", "roleState"], `result.tasks.${taskId}`);
  const summary = requireString(value.summary, `result.tasks.${taskId}.summary`);
  if (!Array.isArray(value.artifacts)) throw new TaskRunRecordError(`result.tasks.${taskId}.artifacts must be an array`);
  if (!Array.isArray(value.blockers) || value.blockers.some((blocker) => typeof blocker !== "string")) {
    throw new TaskRunRecordError(`result.tasks.${taskId}.blockers must be an array of strings`);
  }
  const artifacts = value.artifacts.map((artifact, index) => {
    if (!isRecord(artifact)) throw new TaskRunRecordError(`result.tasks.${taskId}.artifacts[${index}] must be an object`);
    exactFields(artifact, ["path", "description"], `result.tasks.${taskId}.artifacts[${index}]`);
    return {
      path: requireString(artifact.path, `result.tasks.${taskId}.artifacts[${index}].path`),
      description: requireString(artifact.description, `result.tasks.${taskId}.artifacts[${index}].description`),
    };
  });
  const parsePair = (item: unknown, fields: readonly string[], path: string): Record<string, string> | undefined => {
    if (item === undefined) return undefined;
    if (!isRecord(item)) throw new TaskRunRecordError(`${path} must be an object`);
    exactFields(item, fields, path);
    return Object.fromEntries(fields.map((field) => [field, requireString(item[field], `${path}.${field}`)]));
  };
  const needsUserInput = parsePair(value.needsUserInput, ["question", "context"], `result.tasks.${taskId}.needsUserInput`);
  const needsDelegation = parsePair(value.needsDelegation, ["role", "task"], `result.tasks.${taskId}.needsDelegation`);
  let roleState: TaskResult["roleState"];
  if (value.roleState !== undefined) {
    if (!isRecord(value.roleState)) throw new TaskRunRecordError(`result.tasks.${taskId}.roleState must be an object`);
    const stateValue = value.roleState;
    exactFields(stateValue, ["summary", "decisions", "blockers", "nextActions"], `result.tasks.${taskId}.roleState`);
    const stringList = (field: "decisions" | "blockers" | "nextActions"): string[] => {
      const list = stateValue[field];
      if (!Array.isArray(list) || list.some((item) => typeof item !== "string")) throw new TaskRunRecordError(`result.tasks.${taskId}.roleState.${field} must be an array of strings`);
      return [...list];
    };
    roleState = {
      summary: requireString(stateValue.summary, `result.tasks.${taskId}.roleState.summary`),
      decisions: stringList("decisions"),
      blockers: stringList("blockers"),
      nextActions: stringList("nextActions"),
    };
  }
  return {
    summary,
    artifacts,
    blockers: [...value.blockers],
    ...(needsUserInput === undefined ? {} : { needsUserInput: needsUserInput as { question: string; context: string } }),
    ...(needsDelegation === undefined ? {} : { needsDelegation: needsDelegation as { role: string; task: string } }),
    ...(roleState === undefined ? {} : { roleState }),
  };
}

function validateWorkflowResult(value: unknown, task: StoredTask): WorkflowResult {
  if (!isRecord(value) || value.graph !== task.graph.name || !isRecord(value.tasks)) {
    throw new TaskRunRecordError("result must contain the current Task Graph name and task-result mapping");
  }
  const taskResults = value.tasks;
  const expectedIds = task.graph.tasks.map((node) => node.id).sort();
  const actualIds = Object.keys(taskResults).sort();
  if (expectedIds.length !== actualIds.length || expectedIds.some((id, index) => id !== actualIds[index])) {
    throw new TaskRunRecordError("result task IDs must exactly match the persisted Task Graph");
  }
  return {
    graph: task.graph.name,
    tasks: Object.fromEntries(task.graph.tasks.map((node) => [node.id, parseTaskResult(taskResults[node.id], node.id)])),
  };
}

async function requireArtifactFile(projectRoot: string, declaredPath: string): Promise<{ sourcePath: string; sourceRelativePath: string; stat: Stats; contents: Buffer }> {
  let normalized: string;
  try {
    normalized = normalizeProjectRelativePath(declaredPath, "Artifact path");
    await assertProjectContainedPath(projectRoot, normalized, "Artifact path");
  } catch (error) {
    if (error instanceof ProjectPathError) throw new TaskRunRecordError(error.message);
    throw error;
  }
  const sourcePath = resolve(projectRoot, normalized);

  let stat: Stats;
  try {
    stat = await lstat(sourcePath);
  } catch {
    throw new TaskRunRecordError(`Artifact file does not exist: ${declaredPath}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new TaskRunRecordError(`Artifact must be a regular project file: ${declaredPath}`);
  }
  if (stat.size > MAX_ARTIFACT_BYTES) {
    throw new TaskRunRecordError(`Artifact exceeds the ${MAX_ARTIFACT_BYTES} byte snapshot limit: ${declaredPath}`);
  }
  return {
    sourcePath,
    sourceRelativePath: relative(projectRoot, sourcePath).split(sep).join("/"),
    stat,
    contents: await readFile(sourcePath),
  };
}

async function prepareArtifactSnapshots(projectRoot: string, task: StoredTask, run: PreparedRun, recordedAt: string, result: WorkflowResult): Promise<SnapshotInput[]> {
  const snapshots: SnapshotInput[] = [];
  for (const node of task.graph.tasks) {
    const taskResult = result.tasks[node.id];
    if (!taskResult) throw new TaskRunRecordError(`result has no value for task "${node.id}"`);
    for (const [index, declared] of taskResult.artifacts.entries()) {
      const source = await requireArtifactFile(projectRoot, declared.path);
      const id = `artifact-${task.id}-${run.id}-${node.id}-${String(index + 1).padStart(3, "0")}`;
      snapshots.push({
        record: {
          schemaVersion: TASK_MEMORY_SCHEMA_VERSION,
          id,
          taskId: task.id,
          runId: run.id,
          taskNodeId: node.id,
          role: node.role,
          sourcePath: source.sourceRelativePath,
          description: declared.description,
          snapshotPath: `.maestro/artifacts/${id}/content`,
          sha256: createHash("sha256").update(source.contents).digest("hex"),
          byteLength: source.stat.size,
          recordedAt,
        },
        contents: source.contents,
      });
    }
  }
  return snapshots;
}

async function writeArtifactSnapshot(projectRoot: string, snapshot: SnapshotInput): Promise<void> {
  const directory = artifactDirectory(projectRoot, snapshot.record.id);
  await mkdir(dirname(directory), { recursive: true });
  let created = false;
  try {
    await mkdir(directory);
    created = true;
    await writeFile(artifactContentPath(projectRoot, snapshot.record.id), snapshot.contents, { flag: "wx" });
    await writeFile(artifactMetadataPath(projectRoot, snapshot.record.id), `${JSON.stringify(snapshot.record, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    if (created) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error;
    try {
      const [contents, metadata] = await Promise.all([
        readFile(artifactContentPath(projectRoot, snapshot.record.id)),
        readFile(artifactMetadataPath(projectRoot, snapshot.record.id), "utf8"),
      ]);
      if (!contents.equals(snapshot.contents)
        || JSON.stringify(JSON.parse(metadata)) !== JSON.stringify(snapshot.record)) {
        throw new TaskRunRecordError(`artifact snapshot "${snapshot.record.id}" already exists with different content`);
      }
      return;
    } catch (verificationError) {
      if (verificationError instanceof TaskRunRecordError) throw verificationError;
      throw new TaskRunRecordError(`artifact snapshot "${snapshot.record.id}" is incomplete or unreadable`);
    }
  }
}

async function writeRecordedRun(projectRoot: string, taskId: string, run: RecordedRun): Promise<void> {
  const path = runResultPath(projectRoot, taskId, run.id);
  try {
    await atomicCreateJson(path, run);
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error;
    const existing = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (JSON.stringify(existing) !== JSON.stringify(run)) {
      throw new TaskRunRecordError(`run result "${run.id}" already exists with different content`);
    }
  }
}

type RunCommit = {
  schemaVersion: typeof TASK_MEMORY_SCHEMA_VERSION;
  taskId: string;
  runId: string;
  taskRevision: number;
  resultDigest: string;
  recordedAt: string;
};

async function prepareRunCommit(projectRoot: string, task: StoredTask, run: PreparedRun, result: WorkflowResult, recordedAt: string): Promise<RunCommit> {
  const path = runCommitPath(projectRoot, task.id, run.id);
  const resultDigest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
  const proposed: RunCommit = {
    schemaVersion: TASK_MEMORY_SCHEMA_VERSION,
    taskId: task.id,
    runId: run.id,
    taskRevision: task.revision,
    resultDigest,
    recordedAt,
  };
  try {
    await atomicCreateJson(path, proposed);
    return proposed;
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error;
    const existing = JSON.parse(await readFile(path, "utf8")) as RunCommit;
    if (existing.schemaVersion !== proposed.schemaVersion
      || existing.taskId !== proposed.taskId
      || existing.runId !== proposed.runId
      || existing.taskRevision !== proposed.taskRevision
      || existing.resultDigest !== proposed.resultDigest
      || typeof existing.recordedAt !== "string") {
      throw new TaskRunRecordError(`run commit "${run.id}" conflicts with the supplied result`);
    }
    return existing;
  }
}

function derivedMemory(task: StoredTask, run: PreparedRun, result: WorkflowResult, artifactIds: string[], createdAt: string): MemoryEntry {
  const blocked = Object.values(result.tasks).some((taskResult) => taskResult.blockers.length > 0);
  const text = [
    `Task ${task.id} revision ${task.revision} run ${run.id} is ${blocked ? "blocked" : "completed"}.`,
    ...task.graph.tasks.map((node) => {
      const item = result.tasks[node.id];
      return `${node.id} (${node.role}): ${item?.summary ?? ""}\nBlockers: ${(item?.blockers ?? []).join(" | ") || "none"}`;
    }),
  ].join("\n\n").slice(0, MAX_MEMORY_ENTRY_CHARACTERS);
  return {
    schemaVersion: TASK_MEMORY_SCHEMA_VERSION,
    id: `memory-${task.id}-${run.id}`,
    taskId: task.id,
    runId: run.id,
    tags: [...new Set([task.id, task.graph.name, ...task.graph.tasks.flatMap((node) => [node.id, node.role])])],
    text,
    sourceArtifactIds: artifactIds,
    createdAt,
  };
}

/** Validates and records the sole active DSH run; it never invokes DSH itself. */
export async function recordTaskRun(options: RecordTaskRunOptions): Promise<RecordedTaskRun> {
  return withTaskLock(taskLockPath(options.projectRoot, options.taskId), async () => {
    const task = await loadTask({ projectRoot: options.projectRoot, taskId: options.taskId });
    if (task.activeRunId === undefined) throw new TaskRunRecordError(`task "${task.id}" has no active run to record`);
    let prepared: PreparedRun;
    try {
      prepared = await loadPreparedRun(options.projectRoot, task);
    } catch (error) {
      if (error instanceof TaskRunConflictError) throw new TaskRunRecordError(error.message);
      throw error;
    }
    const result = validateWorkflowResult(options.result, task);
    const proposedRecordedAt = timestamp(options.clock);
    await prepareArtifactSnapshots(options.projectRoot, task, prepared, proposedRecordedAt, result);
    const commit = await prepareRunCommit(options.projectRoot, task, prepared, result, proposedRecordedAt);
    const recordedAt = commit.recordedAt;
    const snapshots = await prepareArtifactSnapshots(options.projectRoot, task, prepared, recordedAt, result);
    for (const snapshot of snapshots) await writeArtifactSnapshot(options.projectRoot, snapshot);

    const artifactIds = snapshots.map((snapshot) => snapshot.record.id);
    const memory = derivedMemory(task, prepared, result, artifactIds, recordedAt);
    await writeMemoryEntry({ projectRoot: options.projectRoot, entry: memory });

    const blocked = Object.values(result.tasks).some((taskResult) => taskResult.blockers.length > 0);
    const run: RecordedRun = {
      ...prepared,
      status: blocked ? "blocked" : "completed",
      recordedAt,
      result,
      artifactIds,
      memoryEntryId: memory.id,
    };
    await writeRecordedRun(options.projectRoot, task.id, run);
    for (const node of task.graph.tasks) {
      const state = result.tasks[node.id]?.roleState;
      if (state !== undefined) {
        await writeRoleState({
          projectRoot: options.projectRoot,
          state: {
            schemaVersion: 1,
            taskId: task.id,
            role: node.role,
            ...state,
            sourceRunId: prepared.id,
            updatedAt: recordedAt,
          },
        });
      }
    }
    const updatedTask: StoredTask = {
      ...task,
      status: blocked ? "blocked" : "completed",
      updatedAt: recordedAt,
    };
    delete updatedTask.activeRunId;
    await persistTask(options.projectRoot, updatedTask);
    return { task: updatedTask, run, artifacts: snapshots.map((snapshot) => snapshot.record), memory };
  });
}
