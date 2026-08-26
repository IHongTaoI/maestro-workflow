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
  return pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || posix.isAbsolute(pathFromRoot.replaceAll("\\", "/"));
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
