import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { appendJsonLine, atomicCreateJson, atomicWriteFile, atomicWriteJson } from "../runtime/atomic.ts";
import { withTaskLock } from "../runtime/task-lock.ts";
import { loadMemoryEntry } from "../task-memory/memory-store.ts";
import { loadTask } from "../task-memory/task-store.ts";
import {
  draftMemoryPath,
  currentMemorySummaryPath,
  projectStateRoot,
  roleHistoryPath,
  roleStatePath,
  wikiCurrentPath,
  wikiDirectory,
  wikiVersionPath,
} from "../task-memory/paths.ts";
import type { CurrentMemorySummary, RoleState, TemporaryDraft, WikiEntry, WikiExcerpt } from "./contracts.ts";

const MAX_ROLE_STATE_CHARACTERS = 4_096;
const MAX_WIKI_EXCERPTS = 6;
const MAX_WIKI_CHARACTERS = 8_000;

export class ThreeLayerMemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThreeLayerMemoryError";
  }
}

function now(clock?: () => Date): string {
  return (clock ?? (() => new Date()))().toISOString();
}

function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function memoryLockPath(projectRoot: string, id: string): string {
  return resolve(projectStateRoot(projectRoot), "locks", `memory-${id}.lock`);
}

export async function createTemporaryDraft(options: {
  projectRoot: string;
  id: string;
  text: string;
  workspaceId?: string;
  clock?: () => Date;
}): Promise<TemporaryDraft> {
  if (options.text.trim() === "") throw new ThreeLayerMemoryError("draft text must not be empty");
  const timestamp = now(options.clock);
  const draft: TemporaryDraft = {
    schemaVersion: 1,
    id: options.id,
    text: options.text,
    status: "unconfirmed",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(options.workspaceId === undefined ? {} : { workspaceId: options.workspaceId }),
  };
  await atomicCreateJson(draftMemoryPath(options.projectRoot, options.id), draft);
  return draft;
}

export async function setTemporaryDraftStatus(options: {
  projectRoot: string;
  id: string;
  status: "confirmed" | "discarded";
  clock?: () => Date;
}): Promise<TemporaryDraft> {
  return withTaskLock(memoryLockPath(options.projectRoot, `draft-${options.id}`), async () => {
    const path = draftMemoryPath(options.projectRoot, options.id);
    let current: TemporaryDraft;
    try {
      current = JSON.parse(await readFile(path, "utf8")) as TemporaryDraft;
    } catch (error) {
      if (missing(error)) throw new ThreeLayerMemoryError(`draft "${options.id}" does not exist`);
      throw error;
    }
    if (current.status !== "unconfirmed") {
      if (current.status === options.status) return current;
      throw new ThreeLayerMemoryError(`draft "${options.id}" is already ${current.status}`);
    }
    const updated: TemporaryDraft = { ...current, status: options.status, updatedAt: now(options.clock) };
    await atomicWriteJson(path, updated);
    return updated;
  });
}

export async function loadRoleState(projectRoot: string, taskId: string, role: string): Promise<RoleState | undefined> {
  try {
    const source = await readFile(roleStatePath(projectRoot, taskId, role), "utf8");
    const match = /<!-- maestro-role-state\n([\s\S]*?)\n-->/.exec(source);
    if (match?.[1] === undefined) throw new ThreeLayerMemoryError(`role state for ${taskId}/${role} has no machine-readable payload`);
    return JSON.parse(match[1]) as RoleState;
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}

export async function writeRoleState(options: {
  projectRoot: string;
  state: RoleState;
}): Promise<void> {
  const serialized = JSON.stringify(options.state);
  if (serialized.length > MAX_ROLE_STATE_CHARACTERS) {
    throw new ThreeLayerMemoryError(`role current state exceeds ${MAX_ROLE_STATE_CHARACTERS} characters`);
  }
  const path = roleStatePath(options.projectRoot, options.state.taskId, options.state.role);
  await withTaskLock(memoryLockPath(options.projectRoot, `role-${options.state.taskId}-${options.state.role}`), async () => {
    const previous = await loadRoleState(options.projectRoot, options.state.taskId, options.state.role);
    if (previous !== undefined && JSON.stringify(previous) !== serialized) {
      await appendJsonLine(roleHistoryPath(options.projectRoot, options.state.taskId, options.state.role), previous);
    }
    const markdown = [
      `# ${options.state.role} current state`, "", `Updated: ${options.state.updatedAt}`,
      "", "## Summary", "", options.state.summary,
      "", "## Decisions", "", ...(options.state.decisions.length === 0 ? ["- none"] : options.state.decisions.map((item) => `- ${item}`)),
      "", "## Blockers", "", ...(options.state.blockers.length === 0 ? ["- none"] : options.state.blockers.map((item) => `- ${item}`)),
      "", "## Next actions", "", ...(options.state.nextActions.length === 0 ? ["- none"] : options.state.nextActions.map((item) => `- ${item}`)),
      "", "<!-- maestro-role-state", serialized, "-->", "",
    ].join("\n");
    await atomicWriteFile(path, markdown);
  });
}

export async function writeCurrentMemorySummary(options: {
  projectRoot: string;
  summary: Omit<CurrentMemorySummary, "schemaVersion" | "sourceHash">;
}): Promise<CurrentMemorySummary> {
  await loadMemoryEntry(options.projectRoot, options.summary.throughMemoryId);
  const sourceHash = createHash("sha256").update(JSON.stringify(options.summary)).digest("hex");
  const value: CurrentMemorySummary = { schemaVersion: 1, ...options.summary, sourceHash };
  const markdown = [
    "# Current Memory Summary", "", `generated_at: ${value.generatedAt}`,
    `through_memory_id: ${value.throughMemoryId}`, `source_hash: ${value.sourceHash}`,
    "", "## Goal", "", value.goal,
    "", "## Decisions", "", ...value.decisions.map((item) => `- ${item}`),
    "", "## Constraints", "", ...value.constraints.map((item) => `- ${item}`),
    "", "## Frozen versions", "", ...value.frozenVersions.map((item) => `- ${item}`),
    "", "## Open questions", "", ...value.openQuestions.map((item) => `- ${item}`),
    "", "<!-- maestro-memory-summary", JSON.stringify(value), "-->", "",
  ].join("\n");
  await atomicWriteFile(currentMemorySummaryPath(options.projectRoot), markdown);
  return value;
}

export async function loadCurrentMemorySummary(projectRoot: string): Promise<CurrentMemorySummary | undefined> {
  try {
    const source = await readFile(currentMemorySummaryPath(projectRoot), "utf8");
    const match = /<!-- maestro-memory-summary\n([\s\S]*?)\n-->/.exec(source);
    if (match?.[1] === undefined) throw new ThreeLayerMemoryError("current memory summary has no machine-readable payload");
    const value = JSON.parse(match[1]) as CurrentMemorySummary;
    const { schemaVersion: _schemaVersion, sourceHash, ...summary } = value;
    if (sourceHash !== createHash("sha256").update(JSON.stringify(summary)).digest("hex")) {
      throw new ThreeLayerMemoryError("current memory summary source hash mismatch");
    }
    return value;
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}

function wikiDigest(value: Omit<WikiEntry, "digest">): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function promoteWikiEntry(options: {
  projectRoot: string;
  id: string;
  title: string;
  body: string;
  tags: string[];
  sourceMemoryIds: string[];
  clock?: () => Date;
}): Promise<WikiEntry> {
  if (options.title.trim() === "" || options.body.trim() === "") {
    throw new ThreeLayerMemoryError("wiki title and body must not be empty");
  }
  if (options.sourceMemoryIds.length === 0) {
    throw new ThreeLayerMemoryError("wiki promotion requires at least one source memory id");
  }
  const sources = await Promise.all(options.sourceMemoryIds.map((id) => loadMemoryEntry(options.projectRoot, id)));
  const sourceTasks = await Promise.all([...new Set(sources.map((source) => source.taskId))]
    .map((taskId) => loadTask({ projectRoot: options.projectRoot, taskId })));
  const unaccepted = sourceTasks.find((task) => task.status !== "completed");
  if (unaccepted !== undefined) {
    throw new ThreeLayerMemoryError(`wiki source task "${unaccepted.id}" is not completed`);
  }

  return withTaskLock(memoryLockPath(options.projectRoot, `wiki-${options.id}`), async () => {
    let current: WikiEntry | undefined;
    try {
      current = JSON.parse(await readFile(wikiCurrentPath(options.projectRoot, options.id), "utf8")) as WikiEntry;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const timestamp = now(options.clock);
    const withoutDigest: Omit<WikiEntry, "digest"> = {
      schemaVersion: 1,
      id: options.id,
      revision: (current?.revision ?? 0) + 1,
      title: options.title,
      body: options.body,
      tags: [...new Set(options.tags)],
      sourceMemoryIds: [...new Set(options.sourceMemoryIds)],
      status: "current",
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const entry: WikiEntry = { ...withoutDigest, digest: wikiDigest(withoutDigest) };
    await mkdir(wikiDirectory(options.projectRoot, options.id), { recursive: true });
    await atomicCreateJson(wikiVersionPath(options.projectRoot, options.id, entry.revision), entry);
    await atomicWriteJson(wikiCurrentPath(options.projectRoot, options.id), entry);
    return entry;
  });
}

function tokens(values: readonly string[]): string[] {
  return [...new Set(values.flatMap((value) => (
    [...value.toLocaleLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu)].map((match) => match[0] ?? "")
  )).filter(Boolean))];
}

export async function queryWiki(projectRoot: string, queries: readonly string[]): Promise<WikiExcerpt[]> {
  const queryTokens = tokens(queries);
  if (queryTokens.length === 0) return [];
  const root = resolve(projectStateRoot(projectRoot), "wiki");
  let directories;
  try {
    directories = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
  const loaded = await Promise.allSettled(directories.filter((item) => item.isDirectory()).map(async (item) => {
    const entry = JSON.parse(await readFile(wikiCurrentPath(projectRoot, item.name), "utf8")) as WikiEntry;
    const { digest, ...withoutDigest } = entry;
    if (digest !== wikiDigest(withoutDigest)) throw new ThreeLayerMemoryError(`wiki "${item.name}" digest mismatch`);
    return entry;
  }));
  const scored = loaded.flatMap((result) => result.status === "fulfilled" ? [result.value] : []).map((entry) => {
    const tagSet = new Set(tokens(entry.tags));
    const haystack = `${entry.title} ${entry.body}`.toLocaleLowerCase();
    const score = queryTokens.reduce((total, token) => total + (tagSet.has(token) ? 5 : haystack.includes(token) ? 1 : 0), 0);
    return { entry, score };
  }).filter(({ score }) => score > 0).sort((left, right) => (
    right.score - left.score || right.entry.updatedAt.localeCompare(left.entry.updatedAt)
  ));

  let remaining = MAX_WIKI_CHARACTERS;
  const excerpts: WikiExcerpt[] = [];
  for (const { entry } of scored.slice(0, MAX_WIKI_EXCERPTS)) {
    if (remaining <= 0) break;
    const body = entry.body.slice(0, remaining);
    excerpts.push({
      id: entry.id,
      revision: entry.revision,
      title: entry.title,
      body,
      tags: [...entry.tags],
      sourceMemoryIds: [...entry.sourceMemoryIds],
      updatedAt: entry.updatedAt,
    });
    remaining -= body.length;
  }
  return excerpts;
}
