export const WORK_MODES = ["lite", "plan", "workflow", "diagnosis"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const WORKSPACE_STAGES = [
  "intake",
  "diagnosis",
  "requirements",
  "design",
  "architecture",
  "planning",
  "implementation",
  "testing",
  "delivery",
  "completed",
] as const;
export type WorkspaceStage = (typeof WORKSPACE_STAGES)[number];

export type RevisionSeverity = "minor" | "major" | "critical";

export type WorkspaceMeta = {
  schemaVersion: 1;
  id: string;
  identity: string;
  mode: WorkMode;
  status: "active" | "paused" | "blocked" | "completed";
  currentStage: WorkspaceStage;
  stageRevisions: Partial<Record<WorkspaceStage, number>>;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceCheckpoint = {
  schemaVersion: 1;
  workspaceId: string;
  stage: WorkspaceStage;
  revision: number;
  frozenAt: string;
  files: Array<{ path: string; sha256: string; byteLength: number }>;
};

export type WorkspaceEvent = {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  type: "workspace.created" | "stage.frozen" | "stage.advanced" | "stage.revised" | "workspace.paused" | "workspace.resumed";
  at: string;
  data: Record<string, unknown>;
};
