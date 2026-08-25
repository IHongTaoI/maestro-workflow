import { cp, lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export type ProjectSkillInstallResult = {
  status: "installed" | "unchanged";
  targetPath: string;
};

export type ProjectSkillVerificationResult = {
  status: "installed" | "missing" | "modified";
  targetPath: string;
};

export type InstallProjectSkillOptions = {
  projectRoot: string;
  sourceSkillRoot: string;
  force?: boolean;
};

/** The bundled Skill is copied here because this is a DSH project-level Skill root. */
export function projectSkillTarget(projectRoot: string): string {
  return resolve(projectRoot, ".dsh", "skills", "maestro-workflow");
}

export class ProjectSkillConflictError extends Error {
  readonly targetPath: string;

  constructor(targetPath: string) {
    super(`Refusing to overwrite modified project Skill at ${targetPath}. Re-run with force: true to replace it.`);
    this.name = "ProjectSkillConflictError";
    this.targetPath = targetPath;
  }
}

type FileTree = ReadonlyMap<string, Buffer>;

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function requireDirectory(path: string, stat: Stats, description: string): void {
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${description} must be a real directory: ${path}`);
  }
}

async function readTree(root: string): Promise<FileTree> {
  const rootStat = await lstat(root);
  requireDirectory(root, rootStat, "Skill root");

  const files = new Map<string, Buffer>();
  async function visit(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left: Dirent, right: Dirent) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      const relativePath = relative(root, absolutePath);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Skill contains an unsupported non-file entry: ${absolutePath}`);
      }
      files.set(relativePath, await readFile(absolutePath));
    }
  }

  await visit(root);
  return files;
}

async function readExistingTree(root: string): Promise<FileTree | undefined> {
  try {
    return await readTree(root);
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

function treesMatch(left: FileTree, right: FileTree): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [path, contents] of left) {
    const otherContents = right.get(path);
    if (otherContents === undefined || !contents.equals(otherContents)) {
      return false;
    }
  }
  return true;
}

async function verifyProjectRoot(projectRoot: string): Promise<void> {
  const rootStat = await lstat(projectRoot);
  requireDirectory(projectRoot, rootStat, "Project root");
}

async function ensureSafeTargetParents(targetPath: string): Promise<void> {
  const skillsDirectory = dirname(targetPath);
  const dshDirectory = dirname(skillsDirectory);

  for (const [directory, description] of [[dshDirectory, ".dsh directory"], [skillsDirectory, ".dsh/skills directory"]] as const) {
    try {
      const stat = await lstat(directory);
      requireDirectory(directory, stat, description);
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
      await mkdir(directory, { recursive: true });
    }
  }
}

/**
 * Copies the bundled Maestro Skill into a project-level DSH Skill root.
 * Existing user changes are never replaced unless force is explicitly true.
 */
export async function installProjectSkill(options: InstallProjectSkillOptions): Promise<ProjectSkillInstallResult> {
  await verifyProjectRoot(options.projectRoot);
  const targetPath = projectSkillTarget(options.projectRoot);
  const sourceTree = await readTree(options.sourceSkillRoot);
  const currentTree = await readExistingTree(targetPath);

  if (currentTree !== undefined && treesMatch(sourceTree, currentTree)) {
    return { status: "unchanged", targetPath };
  }
  if (currentTree !== undefined && !options.force) {
    throw new ProjectSkillConflictError(targetPath);
  }

  await ensureSafeTargetParents(targetPath);
  if (currentTree !== undefined) {
    await rm(targetPath, { recursive: true, force: true });
  }
  await cp(options.sourceSkillRoot, targetPath, { recursive: true, errorOnExist: true });
  return { status: "installed", targetPath };
}

/** Compares the installed files byte-for-byte with the bundled project Skill. */
export async function verifyProjectSkill(options: Pick<InstallProjectSkillOptions, "projectRoot" | "sourceSkillRoot">): Promise<ProjectSkillVerificationResult> {
  await verifyProjectRoot(options.projectRoot);
  const targetPath = projectSkillTarget(options.projectRoot);
  const [sourceTree, currentTree] = await Promise.all([
    readTree(options.sourceSkillRoot),
    readExistingTree(targetPath),
  ]);

  if (currentTree === undefined) {
    return { status: "missing", targetPath };
  }
  return { status: treesMatch(sourceTree, currentTree) ? "installed" : "modified", targetPath };
}
