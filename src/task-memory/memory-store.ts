import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";

import { TASK_MEMORY_SCHEMA_VERSION, type MemoryEntry, type MemoryExcerpt } from "./contracts.ts";
import { memoryDirectory, memoryEntryPath } from "./paths.ts";

const MAX_MEMORY_EXCERPTS = 8;
const MAX_MEMORY_CHARACTERS = 6_000;

export type WriteMemoryEntryOptions = {
  projectRoot: string;
  entry: MemoryEntry;
};

export type QueryProjectMemoryOptions = {
  projectRoot: string;
  queries: readonly string[];
  limit?: number;
  maximumCharacters?: number;
  taskId?: string;
  role?: string;
};

export class MemoryStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryStoreError";
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMemoryEntry(value: unknown, expectedId: string): MemoryEntry {
  if (!isRecord(value)
    || value.schemaVersion !== TASK_MEMORY_SCHEMA_VERSION
    || value.id !== expectedId
    || typeof value.taskId !== "string"
    || typeof value.runId !== "string"
    || !Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string")
    || typeof value.text !== "string"
    || !Array.isArray(value.sourceArtifactIds) || value.sourceArtifactIds.some((id) => typeof id !== "string")
    || typeof value.createdAt !== "string"
    || (value.scope !== undefined && !["project", "task", "role"].includes(String(value.scope)))
    || (value.role !== undefined && typeof value.role !== "string")
    || (value.kind !== undefined && !["decision", "constraint", "fact", "failure", "summary"].includes(String(value.kind)))
    || (value.status !== undefined && !["current", "superseded"].includes(String(value.status)))
    || (value.supersedes !== undefined && (!Array.isArray(value.supersedes) || value.supersedes.some((id) => typeof id !== "string")))) {
    throw new MemoryStoreError(`memory entry "${expectedId}" is invalid`);
  }
  return {
    schemaVersion: TASK_MEMORY_SCHEMA_VERSION,
    id: expectedId,
    taskId: value.taskId,
    runId: value.runId,
    tags: [...value.tags],
    text: value.text,
    sourceArtifactIds: [...value.sourceArtifactIds],
    createdAt: value.createdAt,
    ...(typeof value.scope === "string" ? { scope: value.scope as Exclude<MemoryEntry["scope"], undefined> } : {}),
    ...(typeof value.role === "string" ? { role: value.role } : {}),
    ...(typeof value.kind === "string" ? { kind: value.kind as Exclude<MemoryEntry["kind"], undefined> } : {}),
    ...(typeof value.status === "string" ? { status: value.status as Exclude<MemoryEntry["status"], undefined> } : {}),
    ...(Array.isArray(value.supersedes) ? { supersedes: [...value.supersedes] as string[] } : {}),
  };
}

function tokens(values: readonly string[]): string[] {
  return [...new Set(values.flatMap((value) => (
    [...value.toLocaleLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu)].map((match) => match[0] ?? "")
  )).filter((token) => token !== ""))];
}

function excerpt(entry: MemoryEntry, remainingCharacters: number): MemoryExcerpt {
  return {
    id: entry.id,
    taskId: entry.taskId,
    runId: entry.runId,
    tags: [...entry.tags],
    text: entry.text.slice(0, remainingCharacters),
    sourceArtifactIds: [...entry.sourceArtifactIds],
    createdAt: entry.createdAt,
    ...(entry.scope === undefined ? {} : { scope: entry.scope }),
    ...(entry.role === undefined ? {} : { role: entry.role }),
    ...(entry.kind === undefined ? {} : { kind: entry.kind }),
    ...(entry.status === undefined ? {} : { status: entry.status }),
  };
}

/** Stores one immutable, source-linked project-memory entry. */
export async function writeMemoryEntry(options: WriteMemoryEntryOptions): Promise<void> {
  const path = memoryEntryPath(options.projectRoot, options.entry.id);
  const normalized = parseMemoryEntry(options.entry, options.entry.id);
  await mkdir(memoryDirectory(options.projectRoot), { recursive: true });
  try {
    await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      const existing = parseMemoryEntry(JSON.parse(await readFile(path, "utf8")) as unknown, options.entry.id);
      if (JSON.stringify(existing) === JSON.stringify(normalized)) return;
      throw new MemoryStoreError(`memory entry "${options.entry.id}" already exists with different content`);
    }
    throw error;
  }
}

async function allEntries(projectRoot: string): Promise<MemoryEntry[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(memoryDirectory(projectRoot), { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));
  const loaded = await Promise.allSettled(files.map(async (file) => {
    const id = file.name.slice(0, -".json".length);
    return parseMemoryEntry(JSON.parse(await readFile(memoryEntryPath(projectRoot, id), "utf8")) as unknown, id);
  }));
  return loaded.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

export async function loadMemoryEntry(projectRoot: string, id: string): Promise<MemoryEntry> {
  try {
    return parseMemoryEntry(JSON.parse(await readFile(memoryEntryPath(projectRoot, id), "utf8")) as unknown, id);
  } catch (error) {
    if (isMissing(error)) throw new MemoryStoreError(`memory entry "${id}" does not exist`);
    throw error;
  }
}

/** Deterministically retrieves bounded excerpts only when the caller supplies query terms. */
export async function queryProjectMemory(options: QueryProjectMemoryOptions): Promise<MemoryExcerpt[]> {
  const queryTokens = tokens(options.queries);
  if (queryTokens.length === 0) return [];

  const scored = (await allEntries(options.projectRoot)).filter((entry) => {
    if (entry.status === "superseded") return false;
    if (options.taskId !== undefined && (entry.scope === "task" || entry.scope === "role") && entry.taskId !== options.taskId) return false;
    if (options.role !== undefined && entry.scope === "role" && entry.role !== options.role) return false;
    return true;
  }).map((entry) => {
    const haystack = `${entry.tags.join(" ")} ${entry.text}`.toLocaleLowerCase();
    const tagSet = new Set(tokens(entry.tags));
    const lexicalScore = queryTokens.reduce((total, token) => total + (tagSet.has(token) ? 4 : haystack.includes(token) ? 1 : 0), 0);
    const scopeScore = options.taskId === entry.taskId ? 3 : 0;
    const roleScore = options.role !== undefined && options.role === entry.role ? 2 : 0;
    const score = lexicalScore + scopeScore + roleScore;
    return { entry, score };
  }).filter(({ score }) => score > 0).sort((left, right) => (
    right.score - left.score
      || right.entry.createdAt.localeCompare(left.entry.createdAt)
      || left.entry.id.localeCompare(right.entry.id)
  ));

  const limit = Math.min(options.limit ?? MAX_MEMORY_EXCERPTS, MAX_MEMORY_EXCERPTS);
  let remainingCharacters = Math.min(options.maximumCharacters ?? MAX_MEMORY_CHARACTERS, MAX_MEMORY_CHARACTERS);
  const selected: MemoryExcerpt[] = [];
  for (const { entry } of scored.slice(0, Math.max(limit, 0))) {
    if (remainingCharacters <= 0) break;
    const selectedEntry = excerpt(entry, remainingCharacters);
    selected.push(selectedEntry);
    remainingCharacters -= selectedEntry.text.length;
  }
  return selected;
}
