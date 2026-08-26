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

export function runResultPath(projectRoot: string, taskId: string, runId: string): string {
  requireRunIdentifier(runId);
  return resolve(runDirectory(projectRoot, taskId), `${runId}.result.json`);
}

export function runCommitPath(projectRoot: string, taskId: string, runId: string): string {
  requireRunIdentifier(runId);
  return resolve(runDirectory(projectRoot, taskId), `${runId}.commit.json`);
}

export function taskLockPath(projectRoot: string, taskId: string): string {
  requireIdentifier(taskId, "task id");
  return resolve(projectStateRoot(projectRoot), "locks", `task-${taskId}.lock`);
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

export function currentMemorySummaryPath(projectRoot: string): string {
  return resolve(memoryDirectory(projectRoot), "current-summary.md");
}

export function draftMemoryPath(projectRoot: string, draftId: string): string {
  requireIdentifier(draftId, "draft id");
  return resolve(projectStateRoot(projectRoot), "drafts", `${draftId}.json`);
}

export function roleStatePath(projectRoot: string, taskId: string, role: string): string {
  requireIdentifier(taskId, "task id");
  requireIdentifier(role, "role");
  return resolve(taskDirectory(projectRoot, taskId), "roles", role, "current-state.md");
}

export function roleHistoryPath(projectRoot: string, taskId: string, role: string): string {
  requireIdentifier(taskId, "task id");
  requireIdentifier(role, "role");
  return resolve(taskDirectory(projectRoot, taskId), "roles", role, "history.jsonl");
}

export function wikiDirectory(projectRoot: string, wikiId: string): string {
  requireIdentifier(wikiId, "wiki id");
  return resolve(projectStateRoot(projectRoot), "wiki", wikiId);
}

export function wikiVersionPath(projectRoot: string, wikiId: string, revision: number): string {
  if (!Number.isInteger(revision) || revision < 1 || revision > 999_999) {
    throw new TaskMemoryPathError("wiki revision must be between 1 and 999999");
  }
  return resolve(wikiDirectory(projectRoot, wikiId), `v${String(revision).padStart(6, "0")}.json`);
}

export function wikiCurrentPath(projectRoot: string, wikiId: string): string {
  return resolve(wikiDirectory(projectRoot, wikiId), "current.json");
}
