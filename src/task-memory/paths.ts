import { resolve } from "node:path";

const IDENTIFIER = /^[a-z][a-z0-9-]*$/;
const RUN_IDENTIFIER = /^run-[0-9]{6}$/;

export class TaskMemoryPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskMemoryPathError";
  }
}

function requireIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new TaskMemoryPathError(`${label} must be a lowercase kebab-case identifier`);
  }
}

function requireRunIdentifier(value: string): void {
  if (!RUN_IDENTIFIER.test(value)) {
    throw new TaskMemoryPathError("run id must have the form run-000001");
  }
}

/** Returns the sole V3 project-state root; callers cannot choose an arbitrary storage path. */
export function projectStateRoot(projectRoot: string): string {
  return resolve(projectRoot, ".maestro");
}

export function taskDirectory(projectRoot: string, taskId: string): string {
  requireIdentifier(taskId, "task id");
  return resolve(projectStateRoot(projectRoot), "tasks", taskId);
}

export function taskRecordPath(projectRoot: string, taskId: string): string {
  return resolve(taskDirectory(projectRoot, taskId), "task.json");
}

export function runDirectory(projectRoot: string, taskId: string): string {
  return resolve(taskDirectory(projectRoot, taskId), "runs");
}

export function runReceiptPath(projectRoot: string, taskId: string, runId: string): string {
  requireRunIdentifier(runId);
  return resolve(runDirectory(projectRoot, taskId), `${runId}.json`);
}

export function artifactDirectory(projectRoot: string, artifactId: string): string {
  requireIdentifier(artifactId, "artifact id");
  return resolve(projectStateRoot(projectRoot), "artifacts", artifactId);
}

export function artifactContentPath(projectRoot: string, artifactId: string): string {
  return resolve(artifactDirectory(projectRoot, artifactId), "content");
}

export function artifactMetadataPath(projectRoot: string, artifactId: string): string {
  return resolve(artifactDirectory(projectRoot, artifactId), "metadata.json");
}

export function memoryDirectory(projectRoot: string): string {
  return resolve(projectStateRoot(projectRoot), "memory");
}

export function memoryEntryPath(projectRoot: string, memoryId: string): string {
  requireIdentifier(memoryId, "memory id");
  return resolve(memoryDirectory(projectRoot), `${memoryId}.json`);
}
