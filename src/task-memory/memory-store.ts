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
    || typeof value.createdAt !== "string") {
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
      throw new MemoryStoreError(`memory entry "${options.entry.id}" already exists`);
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
  return Promise.all(files.map(async (file) => {
    const id = file.name.slice(0, -".json".length);
    return parseMemoryEntry(JSON.parse(await readFile(memoryEntryPath(projectRoot, id), "utf8")) as unknown, id);
  }));
}

/** Deterministically retrieves bounded excerpts only when the caller supplies query terms. */
export async function queryProjectMemory(options: QueryProjectMemoryOptions): Promise<MemoryExcerpt[]> {
  const queryTokens = tokens(options.queries);
  if (queryTokens.length === 0) return [];

  const scored = (await allEntries(options.projectRoot)).map((entry) => {
    const haystack = `${entry.tags.join(" ")} ${entry.text}`.toLocaleLowerCase();
    const score = queryTokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
    return { entry, score };
  }).filter(({ score }) => score > 0).sort((left, right) => (
    right.score - left.score || left.entry.id.localeCompare(right.entry.id)
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
