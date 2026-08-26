import { realpath } from "node:fs/promises";
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

/** Resolves an existing path once and returns the canonical in-project target for safe reads. */
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
