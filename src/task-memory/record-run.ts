import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

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
import { artifactContentPath, artifactDirectory, artifactMetadataPath, runReceiptPath } from "./paths.ts";
import { type Clock, loadTask, persistTask } from "./task-store.ts";

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
  exactFields(value, ["summary", "artifacts", "blockers"], `result.tasks.${taskId}`);
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
  return { summary, artifacts, blockers: [...value.blockers] };
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

async function loadPreparedRun(projectRoot: string, task: StoredTask): Promise<PreparedRun> {
  if (task.activeRunId === undefined) throw new TaskRunRecordError(`task "${task.id}" has no active run to record`);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(runReceiptPath(projectRoot, task.id, task.activeRunId), "utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new TaskRunRecordError(`active run "${task.activeRunId}" contains invalid JSON`);
    throw error;
  }
  if (!isRecord(value)
    || value.schemaVersion !== TASK_MEMORY_SCHEMA_VERSION
    || value.id !== task.activeRunId
    || value.taskId !== task.id
    || value.taskRevision !== task.revision
    || value.status !== "running"
    || typeof value.preparedAt !== "string"
    || !Array.isArray(value.memoryQuery) || value.memoryQuery.some((query) => typeof query !== "string")) {
    throw new TaskRunRecordError(`active run "${task.activeRunId}" is not a valid running receipt`);
  }
  return {
    schemaVersion: TASK_MEMORY_SCHEMA_VERSION,
    id: task.activeRunId,
    taskId: task.id,
    taskRevision: task.revision,
    status: "running",
    preparedAt: value.preparedAt,
    memoryQuery: [...value.memoryQuery],
  };
}

function insideProject(projectRoot: string, sourcePath: string): boolean {
  const pathFromProject = relative(projectRoot, sourcePath);
  return pathFromProject !== "" && !pathFromProject.startsWith(`..${sep}`) && pathFromProject !== ".." && !isAbsolute(pathFromProject);
}

async function requireArtifactFile(projectRoot: string, declaredPath: string): Promise<{ sourcePath: string; sourceRelativePath: string; stat: Stats; contents: Buffer }> {
  if (declaredPath.trim() === "" || isAbsolute(declaredPath)) {
    throw new TaskRunRecordError(`Artifact path must be a non-empty project-relative file: ${declaredPath}`);
  }
  const sourcePath = resolve(projectRoot, declaredPath);
  if (!insideProject(projectRoot, sourcePath)) {
    throw new TaskRunRecordError(`Artifact path escapes the project root: ${declaredPath}`);
  }

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
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(artifactContentPath(projectRoot, snapshot.record.id), snapshot.contents, { flag: "wx" });
    await writeFile(artifactMetadataPath(projectRoot, snapshot.record.id), `${JSON.stringify(snapshot.record, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
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
  const task = await loadTask({ projectRoot: options.projectRoot, taskId: options.taskId });
  const prepared = await loadPreparedRun(options.projectRoot, task);
  const result = validateWorkflowResult(options.result, task);
  const recordedAt = timestamp(options.clock);
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
  await writeFile(runReceiptPath(options.projectRoot, task.id, prepared.id), `${JSON.stringify(run, null, 2)}\n`);
  const updatedTask: StoredTask = {
    ...task,
    status: blocked ? "blocked" : "completed",
    updatedAt: recordedAt,
  };
  delete updatedTask.activeRunId;
  await persistTask(options.projectRoot, updatedTask);
  return { task: updatedTask, run, artifacts: snapshots.map((snapshot) => snapshot.record), memory };
}
