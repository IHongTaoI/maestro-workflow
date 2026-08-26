import { mkdir, open, readFile, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

export class TaskLockConflictError extends Error {
  constructor(lockPath: string) {
    super(`task state is locked by another Maestro process: ${lockPath}`);
    this.name = "TaskLockConflictError";
  }
}

type LockRecord = { pid: number; createdAt: string };

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
}

async function removeStaleLock(lockPath: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(lockPath, "utf8")) as Partial<LockRecord>;
    if (typeof value.pid === "number" && !running(value.pid)) {
      await rm(lockPath, { force: true });
      return true;
    }
  } catch {
    // An unreadable lock is not removed automatically; manual inspection is safer.
  }
  return false;
}

async function acquireGuard(lockPath: string): Promise<FileHandle> {
  const guardPath = `${lockPath}.acquire`;
  try {
    return await open(guardPath, "wx");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      throw new TaskLockConflictError(lockPath);
    }
    throw error;
  }
}

async function acquireLock(lockPath: string): Promise<FileHandle> {
  const guardPath = `${lockPath}.acquire`;
  const guard = await acquireGuard(lockPath);
  try {
    try {
      return await open(lockPath, "wx");
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error;
      if (!(await removeStaleLock(lockPath))) throw new TaskLockConflictError(lockPath);
      return await open(lockPath, "wx");
    }
  } finally {
    await guard.close();
    await rm(guardPath, { force: true });
  }
}

/** Serializes all read-modify-write operations for one task across processes. */
export async function withTaskLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true });
  const handle = await acquireLock(lockPath);
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
    await handle.sync();
    return await operation();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}
