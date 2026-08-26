export type DraftStatus = "unconfirmed" | "confirmed" | "discarded";

export type TemporaryDraft = {
  schemaVersion: 1;
  id: string;
  workspaceId?: string;
  text: string;
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
};

export type RoleState = {
  schemaVersion: 1;
  taskId: string;
  role: string;
  summary: string;
  decisions: string[];
  blockers: string[];
  nextActions: string[];
  sourceRunId?: string;
  updatedAt: string;
};

export type WikiEntry = {
  schemaVersion: 1;
  id: string;
  revision: number;
  title: string;
  body: string;
  tags: string[];
  sourceMemoryIds: string[];
  status: "current";
  createdAt: string;
  updatedAt: string;
  digest: string;
};

export type WikiExcerpt = Pick<WikiEntry, "id" | "revision" | "title" | "body" | "tags" | "sourceMemoryIds" | "updatedAt">;

export type CurrentMemorySummary = {
  schemaVersion: 1;
  goal: string;
  decisions: string[];
  constraints: string[];
  frozenVersions: string[];
  openQuestions: string[];
  generatedAt: string;
  throughMemoryId: string;
  sourceHash: string;
};
