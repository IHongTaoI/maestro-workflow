import { lstat, open, realpath } from "node:fs/promises";
import type { Stats } from "node:fs";
import { dirname, posix, relative, resolve, sep } from "node:path";

export class ProjectPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectPathError";
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function outside(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  const portable = pathFromRoot.replaceAll("\\", "/");
  return pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || posix.isAbsolute(portable) || /^[A-Za-z]:\//.test(portable);
}

/** Normalizes a user-supplied project path before any prefix or permission checks. */
export function normalizeProjectRelativePath(value: string, label = "path"): string {
  const input = value.trim().replaceAll("\\", "/");
  if (input === "" || posix.isAbsolute(input) || /^[A-Za-z]:\//.test(input)) {
    throw new ProjectPathError(`${label} must be project-relative: ${value}`);
  }
  const normalized = posix.normalize(input.replace(/^\.\//, ""));
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new ProjectPathError(`${label} escapes project root: ${value}`);
  }
  return normalized;
}

/**
 * Resolves the nearest existing ancestor through symlinks and rejects paths that
 * would leave the configured project root. This works for both existing files
 * and future output paths whose final components do not exist yet.
 */
export async function assertProjectContainedPath(projectRoot: string, projectRelativePath: string, label = "path"): Promise<void> {
  const root = await realpath(resolve(projectRoot));
  let current = resolve(projectRoot, projectRelativePath);
  while (true) {
    try {
      const resolved = await realpath(current);
      if (outside(root, resolved)) throw new ProjectPathError(`${label} escapes project root through a symlink: ${projectRelativePath}`);
      return;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(current);
      if (parent === current) throw new ProjectPathError(`${label} has no existing project ancestor: ${projectRelativePath}`);
      current = parent;
    }
  }
}

/** Resolves an existing path once and returns the canonical in-project target. */
export async function resolveProjectContainedExistingPath(projectRoot: string, projectRelativePath: string, label = "path"): Promise<string> {
  const root = await realpath(resolve(projectRoot));
  let resolved: string;
  try {
    resolved = await realpath(resolve(projectRoot, projectRelativePath));
  } catch (error) {
    if (isMissing(error)) throw new ProjectPathError(`${label} does not exist: ${projectRelativePath}`);
    throw error;
  }
  if (outside(root, resolved)) throw new ProjectPathError(`${label} escapes project root through a symlink: ${projectRelativePath}`);
  return resolved;
}

export type ProjectContainedFile = {
  absolutePath: string;
  projectRelativePath: string;
  stat: Stats;
  contents: Buffer;
};

/**
 * Opens the lexical path first, then validates that the opened inode is the same
 * canonical in-project file currently reachable by that path. The final read is
 * performed from the already-open FileHandle, so a later parent-directory swap
 * cannot redirect the read to another file.
 */
export async function readProjectContainedRegularFile(projectRoot: string, projectRelativePath: string, label = "path"): Promise<ProjectContainedFile> {
  const normalized = normalizeProjectRelativePath(projectRelativePath, label);
  const root = await realpath(resolve(projectRoot));
  const lexicalPath = resolve(projectRoot, normalized);

  let lexicalStat: Stats;
  try {
    lexicalStat = await lstat(lexicalPath);
  } catch (error) {
    if (isMissing(error)) throw new ProjectPathError(`${label} does not exist: ${projectRelativePath}`);
    throw error;
  }
  if (!lexicalStat.isFile() || lexicalStat.isSymbolicLink()) {
    throw new ProjectPathError(`${label} must be a regular project file: ${projectRelativePath}`);
  }

  let handle;
  try {
    handle = await open(lexicalPath, "r");
  } catch (error) {
    if (isMissing(error)) throw new ProjectPathError(`${label} does not exist: ${projectRelativePath}`);
    throw error;
  }

  try {
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) throw new ProjectPathError(`${label} must be a regular project file: ${projectRelativePath}`);

    let canonicalPath: string;
    try {
      canonicalPath = await realpath(lexicalPath);
    } catch (error) {
      if (isMissing(error)) throw new ProjectPathError(`${label} changed while being opened: ${projectRelativePath}`);
      throw error;
    }
    if (outside(root, canonicalPath)) throw new ProjectPathError(`${label} escapes project root through a symlink: ${projectRelativePath}`);

    let canonicalStat: Stats;
    try {
      canonicalStat = await lstat(canonicalPath);
    } catch (error) {
      if (isMissing(error)) throw new ProjectPathError(`${label} changed while being opened: ${projectRelativePath}`);
      throw error;
    }
    if (!canonicalStat.isFile() || openedStat.dev !== canonicalStat.dev || openedStat.ino !== canonicalStat.ino) {
      throw new ProjectPathError(`${label} changed while being opened: ${projectRelativePath}`);
    }

    const contents = await handle.readFile();
    return {
      absolutePath: canonicalPath,
      projectRelativePath: relative(root, canonicalPath).split(sep).join("/"),
      stat: openedStat,
      contents,
    };
  } finally {
    await handle.close();
  }
}
