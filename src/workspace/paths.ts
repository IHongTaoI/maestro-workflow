import { resolve } from "node:path";

const WORKSPACE_ID = /^[a-z0-9][a-z0-9-]*$/;

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

function requireWorkspaceId(id: string): void {
  if (!WORKSPACE_ID.test(id)) throw new WorkspacePathError("workspace id must be lowercase kebab-case");
}

export function workspacesRoot(projectRoot: string): string {
  return resolve(projectRoot, ".agents", ".local", "work");
}

export function workspaceRoot(projectRoot: string, workspaceId: string): string {
  requireWorkspaceId(workspaceId);
  return resolve(workspacesRoot(projectRoot), workspaceId);
}

export function workspaceMetaPath(projectRoot: string, workspaceId: string): string {
  return resolve(workspaceRoot(projectRoot, workspaceId), "meta.json");
}

export function workspaceEventsPath(projectRoot: string, workspaceId: string): string {
  return resolve(workspaceRoot(projectRoot, workspaceId), "events.jsonl");
}

export function workspaceProgressPath(projectRoot: string, workspaceId: string): string {
  return resolve(workspaceRoot(projectRoot, workspaceId), "progress.md");
}

export function workspaceRequestPath(projectRoot: string, workspaceId: string): string {
  return resolve(workspaceRoot(projectRoot, workspaceId), "input", "request.md");
}

export function workspaceCheckpointPath(projectRoot: string, workspaceId: string, stage: string, revision: number): string {
  if (!/^[a-z][a-z-]*$/.test(stage) || !Number.isInteger(revision) || revision < 1) {
    throw new WorkspacePathError("invalid checkpoint identity");
  }
  return resolve(workspaceRoot(projectRoot, workspaceId), "checkpoints", `${stage}-r${String(revision).padStart(3, "0")}.json`);
}

export function workspaceLockPath(projectRoot: string, workspaceId: string): string {
  requireWorkspaceId(workspaceId);
  return resolve(workspacesRoot(projectRoot), ".locks", `${workspaceId}.lock`);
}
