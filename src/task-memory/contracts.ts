import type { TaskGraph } from "../task-graph/types.ts";

export const TASK_MEMORY_SCHEMA_VERSION = 1;
export const TASK_STATUS = ["ready", "running", "blocked", "completed"] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

export type TaskResultArtifact = {
  path: string;
  description: string;
};

export type TaskResult = {
  summary: string;
  artifacts: TaskResultArtifact[];
  blockers: string[];
};

export type WorkflowResult = {
  graph: string;
  tasks: Record<string, TaskResult>;
};

export type StoredTask = {
  schemaVersion: typeof TASK_MEMORY_SCHEMA_VERSION;
  id: string;
  status: TaskStatus;
  revision: number;
  graph: TaskGraph;
  graphDigest: string;
  createdAt: string;
  updatedAt: string;
  activeRunId?: string;
};

export type PreparedRun = {
  schemaVersion: typeof TASK_MEMORY_SCHEMA_VERSION;
  id: string;
  taskId: string;
  taskRevision: number;
  status: "running";
  preparedAt: string;
  memoryQuery: string[];
};

export type ArtifactRecord = {
  schemaVersion: typeof TASK_MEMORY_SCHEMA_VERSION;
  id: string;
  taskId: string;
  runId: string;
  taskNodeId: string;
  role: string;
  sourcePath: string;
  description: string;
  snapshotPath: string;
  sha256: string;
  byteLength: number;
  recordedAt: string;
};

export type MemoryEntry = {
  schemaVersion: typeof TASK_MEMORY_SCHEMA_VERSION;
  id: string;
  taskId: string;
  runId: string;
  tags: string[];
  text: string;
  sourceArtifactIds: string[];
  createdAt: string;
};

export type MemoryExcerpt = Pick<MemoryEntry, "id" | "taskId" | "runId" | "tags" | "text">;

export type PersistedTaskContext = {
  taskId: string;
  taskRevision: number;
  runId: string;
  memory: MemoryExcerpt[];
};

export type RecordedRun = PreparedRun & {
  status: "completed" | "blocked";
  recordedAt: string;
  result: WorkflowResult;
  artifactIds: string[];
  memoryEntryId: string;
};
