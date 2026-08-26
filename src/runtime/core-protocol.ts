import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { atomicCreateJson } from "./atomic.ts";
import { withTaskLock } from "./task-lock.ts";
import { assertProjectContainedPath, normalizeProjectRelativePath, ProjectPathError } from "./project-path.ts";
import { writeMemoryEntry } from "../task-memory/memory-store.ts";
import type { MemoryEntry } from "../task-memory/contracts.ts";
import { workspaceRoot } from "../workspace/paths.ts";

export const CORE_ACTIONS = ["submit_proposal", "validate_proposal", "commit_memory", "collect_result", "apply_permissions"] as const;
export type CoreAction = (typeof CORE_ACTIONS)[number];

export type ProposedEffect = {
  action: "read" | "write" | "execute";
  path: string;
};

export type RuntimeProposal = {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  taskId: string;
  role: string;
  summary: string;
  effects: ProposedEffect[];
  expectedOutputs: string[];
  submittedAt: string;
};

export type PermissionGrant = {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  role: string;
  read: string[];
  write: string[];
  execute: string[];
  appliedAt: string;
};

export type ProposalValidation = {
  schemaVersion: 1;
  proposalId: string;
  permissionGrantId: string;
  status: "approved" | "rejected";
  reasons: string[];
  validatedAt: string;
};

export type CollectedResult = {
  schemaVersion: 1;
  id: string;
  proposalId: string;
  workspaceId: string;
  taskId: string;
  role: string;
  summary: string;
  artifacts: Array<{ path: string; sha256: string; byteLength: number }>;
  blockers: string[];
  collectedAt: string;
};

const IDENTIFIER = /^[a-z][a-z0-9-]*$/;
const PROTECTED = [
  "meta.json",
  "events.jsonl",
  "input/request.md",
  "memory",
  "runtime",
];

export class CoreProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoreProtocolError";
  }
}

function timestamp(clock?: () => Date): string {
  return (clock ?? (() => new Date()))().toISOString();
}

function requireId(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) throw new CoreProtocolError(`${label} must be lowercase kebab-case`);
}

function relativePath(value: string): string {
  try {
    return normalizeProjectRelativePath(value);
  } catch (error) {
    if (error instanceof ProjectPathError) throw new CoreProtocolError(error.message);
    throw error;
  }
}

async function requireContainedPath(projectRoot: string, path: string): Promise<void> {
  try {
    await assertProjectContainedPath(projectRoot, path);
  } catch (error) {
    if (error instanceof ProjectPathError) throw new CoreProtocolError(error.message);
    throw error;
  }
}

function below(path: string, prefix: string): boolean {
  if (prefix === ".") return true;
  return path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

function overlaps(path: string, protectedPath: string): boolean {
  return below(path, protectedPath) || below(protectedPath, path);
}

function protectedWorkspacePaths(projectRoot: string, workspaceId: string): string[] {
  const workspacePrefix = relative(projectRoot, workspaceRoot(projectRoot, workspaceId)).split(sep).join("/");
  return PROTECTED.map((protectedPath) => `${workspacePrefix}/${protectedPath}`);
}

function runtimePath(projectRoot: string, workspaceId: string, directory: string, id: string): string {
  requireId(id, `${directory} id`);
  return resolve(workspaceRoot(projectRoot, workspaceId), "runtime", directory, `${id}.json`);
}

function runtimeLock(projectRoot: string, workspaceId: string, id: string): string {
  return resolve(workspaceRoot(projectRoot, workspaceId), "runtime", "locks", `${id}.lock`);
}

async function loadJson<T>(path: string, label: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new CoreProtocolError(`${label} does not exist`);
    }
    throw error;
  }
}

export async function submitProposal(options: {
  projectRoot: string;
  workspaceId: string;
  taskId: string;
  role: string;
  summary: string;
  effects: ProposedEffect[];
  expectedOutputs: string[];
  id?: string;
  clock?: () => Date;
}): Promise<RuntimeProposal> {
  requireId(options.taskId, "task id");
  requireId(options.role, "role");
  if (options.summary.trim() === "") throw new CoreProtocolError("proposal summary must not be empty");
  const effects = options.effects.map((effect) => ({ ...effect, path: relativePath(effect.path) }));
  const expectedOutputs = options.expectedOutputs.map(relativePath);
  for (const path of [...effects.map((effect) => effect.path), ...expectedOutputs]) await requireContainedPath(options.projectRoot, path);
  const proposal: RuntimeProposal = {
    schemaVersion: 1,
    id: options.id ?? `proposal-${randomUUID()}`,
    workspaceId: options.workspaceId,
    taskId: options.taskId,
    role: options.role,
    summary: options.summary,
    effects,
    expectedOutputs,
    submittedAt: timestamp(options.clock),
  };
  await atomicCreateJson(runtimePath(options.projectRoot, options.workspaceId, "proposals", proposal.id), proposal);
  return proposal;
}

export async function applyPermissions(options: {
  projectRoot: string;
  workspaceId: string;
  role: string;
  read?: string[];
  write?: string[];
  execute?: string[];
  id?: string;
  clock?: () => Date;
}): Promise<PermissionGrant> {
  requireId(options.role, "role");
  const normalize = (values: string[] | undefined): string[] => [...new Set((values ?? []).map(relativePath))];
  const grant: PermissionGrant = {
    schemaVersion: 1,
    id: options.id ?? `permission-${randomUUID()}`,
    workspaceId: options.workspaceId,
    role: options.role,
    read: normalize(options.read),
    write: normalize(options.write),
    execute: normalize(options.execute),
    appliedAt: timestamp(options.clock),
  };
  for (const path of [...grant.read, ...grant.write, ...grant.execute]) await requireContainedPath(options.projectRoot, path);
  const protectedPaths = protectedWorkspacePaths(options.projectRoot, options.workspaceId);
  for (const path of [...grant.write, ...grant.execute]) {
    if (protectedPaths.some((protectedPath) => overlaps(path, protectedPath))) {
      throw new CoreProtocolError(`permission grant cannot expose protected path: ${path}`);
    }
  }
  await atomicCreateJson(runtimePath(options.projectRoot, options.workspaceId, "permissions", grant.id), grant);
  return grant;
}

export async function validateProposal(options: {
  projectRoot: string;
  workspaceId: string;
  proposalId: string;
  permissionGrantId: string;
  clock?: () => Date;
}): Promise<ProposalValidation> {
  const proposal = await loadJson<RuntimeProposal>(runtimePath(options.projectRoot, options.workspaceId, "proposals", options.proposalId), `proposal "${options.proposalId}"`);
  const grant = await loadJson<PermissionGrant>(runtimePath(options.projectRoot, options.workspaceId, "permissions", options.permissionGrantId), `permission grant "${options.permissionGrantId}"`);
  const reasons: string[] = [];
  const protectedPaths = protectedWorkspacePaths(options.projectRoot, options.workspaceId);
  if (proposal.role !== grant.role) reasons.push("proposal role does not match permission grant role");
  for (const effect of proposal.effects) {
    let path: string;
    let allowed: string[];
    try {
      path = relativePath(effect.path);
      await requireContainedPath(options.projectRoot, path);
      allowed = (effect.action === "read" ? grant.read : effect.action === "write" ? grant.write : grant.execute).map(relativePath);
      for (const prefix of allowed) await requireContainedPath(options.projectRoot, prefix);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (effect.action !== "read" && protectedPaths.some((protectedPath) => overlaps(path, protectedPath))) {
      reasons.push(`${effect.action} targets protected path ${path}`);
      continue;
    }
    if (!allowed.some((prefix) => below(path, prefix))) reasons.push(`${effect.action} is not allowed for ${path}`);
  }
  const validation: ProposalValidation = {
    schemaVersion: 1,
    proposalId: proposal.id,
    permissionGrantId: grant.id,
    status: reasons.length === 0 ? "approved" : "rejected",
    reasons,
    validatedAt: timestamp(options.clock),
  };
  await atomicCreateJson(runtimePath(options.projectRoot, options.workspaceId, "validations", proposal.id), validation);
  return validation;
}

export async function collectResult(options: {
  projectRoot: string;
  workspaceId: string;
  proposalId: string;
  summary: string;
  artifactPaths: string[];
  blockers?: string[];
  clock?: () => Date;
}): Promise<CollectedResult> {
  const proposal = await loadJson<RuntimeProposal>(runtimePath(options.projectRoot, options.workspaceId, "proposals", options.proposalId), `proposal "${options.proposalId}"`);
  const validation = await loadJson<ProposalValidation>(runtimePath(options.projectRoot, options.workspaceId, "validations", options.proposalId), `validation for "${options.proposalId}"`);
  if (validation.status !== "approved") throw new CoreProtocolError(`proposal "${proposal.id}" was not approved`);
  const expectedOutputs = proposal.expectedOutputs.map(relativePath);
  const artifacts = [];
  for (const declared of options.artifactPaths.map(relativePath)) {
    await requireContainedPath(options.projectRoot, declared);
    if (!expectedOutputs.some((prefix) => below(declared, prefix))) {
      throw new CoreProtocolError(`result artifact was not declared by proposal: ${declared}`);
    }
    const absolute = resolve(options.projectRoot, declared);
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new CoreProtocolError(`result artifact must be a regular file: ${declared}`);
    const contents = await readFile(absolute);
    artifacts.push({ path: declared, sha256: createHash("sha256").update(contents).digest("hex"), byteLength: contents.length });
  }
  const result: CollectedResult = {
    schemaVersion: 1,
    id: `result-${proposal.id}`,
    proposalId: proposal.id,
    workspaceId: proposal.workspaceId,
    taskId: proposal.taskId,
    role: proposal.role,
    summary: options.summary,
    artifacts,
    blockers: [...(options.blockers ?? [])],
    collectedAt: timestamp(options.clock),
  };
  await atomicCreateJson(runtimePath(options.projectRoot, options.workspaceId, "results", result.id), result);
  return result;
}

export async function commitMemory(options: {
  projectRoot: string;
  workspaceId: string;
  resultId: string;
  memoryId: string;
  runId: string;
  tags: string[];
  kind?: MemoryEntry["kind"];
  clock?: () => Date;
}): Promise<MemoryEntry> {
  return withTaskLock(runtimeLock(options.projectRoot, options.workspaceId, `commit-${options.memoryId}`), async () => {
    const result = await loadJson<CollectedResult>(runtimePath(options.projectRoot, options.workspaceId, "results", options.resultId), `result "${options.resultId}"`);
    const entry: MemoryEntry = {
      schemaVersion: 1,
      id: options.memoryId,
      taskId: result.taskId,
      runId: options.runId,
      tags: [...new Set([...options.tags, result.role, result.taskId])],
      text: `${result.summary}\n\nBlockers: ${result.blockers.join(" | ") || "none"}`,
      sourceArtifactIds: result.artifacts.map((artifact) => artifact.path),
      createdAt: timestamp(options.clock),
      scope: "role",
      role: result.role,
      kind: options.kind ?? "summary",
      status: "current",
    };
    await writeMemoryEntry({ projectRoot: options.projectRoot, entry });
    return entry;
  });
}
