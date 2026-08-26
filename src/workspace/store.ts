import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { appendJsonLine, atomicCreateJson, atomicWriteFile, atomicWriteJson } from "../runtime/atomic.ts";
import { withTaskLock } from "../runtime/task-lock.ts";
import type {
  RevisionSeverity,
  WorkMode,
  WorkspaceCheckpoint,
  WorkspaceEvent,
  WorkspaceMeta,
  WorkspaceStage,
} from "./contracts.ts";
import { WORK_MODES, WORKSPACE_STAGES } from "./contracts.ts";
import {
  workspaceCheckpointPath,
  workspaceEventsPath,
  workspaceLockPath,
  workspaceMetaPath,
  workspaceProgressPath,
  workspaceRequestPath,
  workspaceRoot,
} from "./paths.ts";

const MODE_STAGES: Record<WorkMode, WorkspaceStage[]> = {
  lite: ["intake", "implementation", "testing", "delivery", "completed"],
  plan: ["intake", "planning", "implementation", "testing", "delivery", "completed"],
  workflow: [...WORKSPACE_STAGES],
};

const STAGE_DIRECTORY: Partial<Record<WorkspaceStage, string>> = {
  intake: "input",
  requirements: "requirements",
  design: "design",
  architecture: "design",
  planning: "planning",
  implementation: "implementation",
  testing: "testing",
  delivery: "delivery",
};

const REQUIRED_ARTIFACTS: Partial<Record<WorkspaceStage, string[]>> = {
  requirements: ["requirements/spec.md"],
  design: ["design/design.md"],
  architecture: ["design/architecture.md", "planning/task-graph.yaml"],
  planning: ["planning/task-plan.md", "planning/automated-test-plan.md"],
  implementation: ["implementation/execution.json"],
  testing: ["testing/test-report.md"],
  delivery: ["delivery/report.md"],
};

export class WorkspaceStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceStoreError";
  }
}

function now(clock?: () => Date): string {
  return (clock ?? (() => new Date()))().toISOString();
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function validateMeta(value: unknown, id: string): WorkspaceMeta {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new WorkspaceStoreError(`workspace "${id}" has invalid metadata`);
  const meta = value as Record<string, unknown>;
  if (meta.schemaVersion !== 1 || meta.id !== id
    || typeof meta.identity !== "string" || meta.identity.length > 200
    || typeof meta.mode !== "string" || !(WORK_MODES as readonly string[]).includes(meta.mode)
    || typeof meta.status !== "string" || !["active", "paused", "blocked", "completed"].includes(meta.status)
    || typeof meta.currentStage !== "string" || !(WORKSPACE_STAGES as readonly string[]).includes(meta.currentStage)
    || typeof meta.stageRevisions !== "object" || meta.stageRevisions === null
    || typeof meta.createdAt !== "string" || typeof meta.updatedAt !== "string") {
    throw new WorkspaceStoreError(`workspace "${id}" has invalid metadata`);
  }
  return meta as unknown as WorkspaceMeta;
}

async function event(projectRoot: string, workspaceId: string, type: WorkspaceEvent["type"], at: string, data: Record<string, unknown>): Promise<void> {
  await appendJsonLine(workspaceEventsPath(projectRoot, workspaceId), {
    schemaVersion: 1,
    id: randomUUID(),
    workspaceId,
    type,
    at,
    data,
  } satisfies WorkspaceEvent);
  const progressPath = workspaceProgressPath(projectRoot, workspaceId);
  let entries: string[] = [];
  try {
    entries = (await readFile(progressPath, "utf8")).split("\n").filter((line) => line.startsWith("- "));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  entries.push(`- ${at} ${type} ${JSON.stringify(data)}`);
  const overflow = entries.slice(0, Math.max(0, entries.length - 20));
  const current = entries.slice(-20);
  if (overflow.length > 0) {
    const month = at.slice(0, 7);
    await appendJsonLine(resolve(workspaceRoot(projectRoot, workspaceId), "references", `progress-${month}.jsonl`), { entries: overflow });
  }
  await atomicWriteFile(progressPath, `# Progress\n\n${current.join("\n")}\n`);
}

export async function createWorkspace(options: {
  projectRoot: string;
  workspaceId: string;
  identity: string;
  mode: WorkMode;
  request: string;
  clock?: () => Date;
}): Promise<WorkspaceMeta> {
  if (options.identity.trim() === "" || options.identity.length > 200) throw new WorkspaceStoreError("workspace identity must contain 1-200 characters");
  if (options.request.trim() === "") throw new WorkspaceStoreError("workspace request must not be empty");
  return withTaskLock(workspaceLockPath(options.projectRoot, options.workspaceId), async () => {
    const timestamp = now(options.clock);
    const meta: WorkspaceMeta = {
      schemaVersion: 1,
      id: options.workspaceId,
      identity: options.identity,
      mode: options.mode,
      status: "active",
      currentStage: "intake",
      stageRevisions: { intake: 1 },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await mkdir(workspaceRoot(options.projectRoot, options.workspaceId), { recursive: true });
    await atomicCreateJson(workspaceMetaPath(options.projectRoot, options.workspaceId), meta);
    await atomicWriteFile(workspaceRequestPath(options.projectRoot, options.workspaceId), `${options.request.trim()}\n`);
    await event(options.projectRoot, options.workspaceId, "workspace.created", timestamp, { mode: options.mode });
    return meta;
  });
}

export async function loadWorkspace(projectRoot: string, workspaceId: string): Promise<WorkspaceMeta> {
  try {
    return validateMeta(JSON.parse(await readFile(workspaceMetaPath(projectRoot, workspaceId), "utf8")) as unknown, workspaceId);
  } catch (error) {
    if (isMissing(error)) throw new WorkspaceStoreError(`workspace "${workspaceId}" does not exist`);
    throw error;
  }
}

async function requireGateArtifacts(projectRoot: string, meta: WorkspaceMeta): Promise<void> {
  const required = REQUIRED_ARTIFACTS[meta.currentStage] ?? [];
  for (const path of required) {
    const absolute = resolve(workspaceRoot(projectRoot, meta.id), path);
    try {
      const stat = await lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new WorkspaceStoreError(`stage gate artifact must be a regular file: ${path}`);
      if (meta.currentStage === "testing") {
        const report = await readFile(absolute, "utf8");
        if (!/^status:\s*passed\s*$/im.test(report)) throw new WorkspaceStoreError("testing cannot advance until test-report.md contains status: passed");
      }
      if (meta.currentStage === "delivery") {
        const report = await readFile(absolute, "utf8");
        if (!/^status:\s*accepted\s*$/im.test(report)) throw new WorkspaceStoreError("delivery cannot complete until report.md contains status: accepted");
      }
    } catch (error) {
      if (isMissing(error)) throw new WorkspaceStoreError(`stage gate artifact is missing: ${path}`);
      throw error;
    }
  }
}

async function filesBelow(directory: string, root: string): Promise<WorkspaceCheckpoint["files"]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const files: WorkspaceCheckpoint["files"] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path, root));
    else if (entry.isFile()) {
      const contents = await readFile(path);
      files.push({
        path: relative(root, path).split(sep).join("/"),
        sha256: createHash("sha256").update(contents).digest("hex"),
        byteLength: contents.length,
      });
    }
  }
  return files;
}

async function freezeCurrentStage(projectRoot: string, meta: WorkspaceMeta, frozenAt: string): Promise<WorkspaceCheckpoint> {
  const revision = meta.stageRevisions[meta.currentStage] ?? 1;
  const stageDirectory = STAGE_DIRECTORY[meta.currentStage];
  const root = workspaceRoot(projectRoot, meta.id);
  const checkpoint: WorkspaceCheckpoint = {
    schemaVersion: 1,
    workspaceId: meta.id,
    stage: meta.currentStage,
    revision,
    frozenAt,
    files: stageDirectory === undefined ? [] : await filesBelow(resolve(root, stageDirectory), root),
  };
  await atomicCreateJson(workspaceCheckpointPath(projectRoot, meta.id, meta.currentStage, revision), checkpoint);
  await event(projectRoot, meta.id, "stage.frozen", frozenAt, { stage: meta.currentStage, revision });
  return checkpoint;
}

export async function advanceWorkspace(options: {
  projectRoot: string;
  workspaceId: string;
  clock?: () => Date;
}): Promise<WorkspaceMeta> {
  return withTaskLock(workspaceLockPath(options.projectRoot, options.workspaceId), async () => {
    const current = await loadWorkspace(options.projectRoot, options.workspaceId);
    if (current.status !== "active") throw new WorkspaceStoreError(`workspace "${current.id}" is ${current.status}`);
    const sequence = MODE_STAGES[current.mode];
    const index = sequence.indexOf(current.currentStage);
    const next = sequence[index + 1];
    if (next === undefined) throw new WorkspaceStoreError(`workspace "${current.id}" has no next stage`);
    await requireGateArtifacts(options.projectRoot, current);
    const timestamp = now(options.clock);
    await freezeCurrentStage(options.projectRoot, current, timestamp);
    const updated: WorkspaceMeta = {
      ...current,
      currentStage: next,
      status: next === "completed" ? "completed" : "active",
      stageRevisions: { ...current.stageRevisions, [next]: current.stageRevisions[next] ?? 1 },
      updatedAt: timestamp,
    };
    await atomicWriteJson(workspaceMetaPath(options.projectRoot, current.id), updated);
    await event(options.projectRoot, current.id, "stage.advanced", timestamp, { from: current.currentStage, to: next });
    return updated;
  });
}

export async function reviseWorkspace(options: {
  projectRoot: string;
  workspaceId: string;
  severity: RevisionSeverity;
  targetStage?: WorkspaceStage;
  reason: string;
  clock?: () => Date;
}): Promise<WorkspaceMeta> {
  if (options.reason.trim() === "") throw new WorkspaceStoreError("revision reason must not be empty");
  return withTaskLock(workspaceLockPath(options.projectRoot, options.workspaceId), async () => {
    const current = await loadWorkspace(options.projectRoot, options.workspaceId);
    const sequence = MODE_STAGES[current.mode];
    const criticalTarget: WorkspaceStage = current.mode === "workflow" ? "requirements" : sequence[0] ?? "intake";
    const target = options.severity === "critical" ? criticalTarget : options.targetStage ?? current.currentStage;
    const currentIndex = sequence.indexOf(current.currentStage);
    const targetIndex = sequence.indexOf(target);
    if (targetIndex < 0 || targetIndex > currentIndex) throw new WorkspaceStoreError("revision target must be a completed or current stage in this mode");
    const timestamp = now(options.clock);
    const updated: WorkspaceMeta = {
      ...current,
      currentStage: target,
      status: "active",
      stageRevisions: { ...current.stageRevisions, [target]: (current.stageRevisions[target] ?? 1) + 1 },
      updatedAt: timestamp,
    };
    await atomicWriteJson(workspaceMetaPath(options.projectRoot, current.id), updated);
    await event(options.projectRoot, current.id, "stage.revised", timestamp, { severity: options.severity, target, reason: options.reason });
    return updated;
  });
}

export async function setWorkspacePaused(projectRoot: string, workspaceId: string, paused: boolean, clock?: () => Date): Promise<WorkspaceMeta> {
  return withTaskLock(workspaceLockPath(projectRoot, workspaceId), async () => {
    const current = await loadWorkspace(projectRoot, workspaceId);
    if (current.status === "completed") throw new WorkspaceStoreError("completed workspace cannot be paused or resumed");
    const timestamp = now(clock);
    const updated: WorkspaceMeta = { ...current, status: paused ? "paused" : "active", updatedAt: timestamp };
    await atomicWriteJson(workspaceMetaPath(projectRoot, workspaceId), updated);
    await event(projectRoot, workspaceId, paused ? "workspace.paused" : "workspace.resumed", timestamp, {});
    return updated;
  });
}
