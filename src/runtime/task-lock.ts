import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

export class TaskLockConflictError extends Error {
  constructor(lockPath: string) {
    super(`task state is locked by another Maestro process: ${lockPath}`);
    this.name = "TaskLockConflictError";
  }
}

type LockRecord = { pid: number; createdAt: string; token?: string };
type OwnedRecord = { handle: FileHandle; record: LockRecord };

const GUARD_STALE_MS = 60_000;
const MALFORMED_STALE_MS = 60_000;

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
}

function recordKey(record: LockRecord): string {
  return record.token ?? `${record.pid}:${record.createdAt}`;
}

function stale(record: LockRecord, maximumAgeMs?: number): boolean {
  if (!running(record.pid)) return true;
  if (maximumAgeMs === undefined) return false;
  const createdAt = Date.parse(record.createdAt);
  return Number.isFinite(createdAt) && Date.now() - createdAt > maximumAgeMs;
}

async function readLockRecord(path: string): Promise<LockRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<LockRecord>;
    if (typeof value.pid !== "number" || typeof value.createdAt !== "string" || (value.token !== undefined && typeof value.token !== "string")) {
      return undefined;
    }
    return { pid: value.pid, createdAt: value.createdAt, ...(value.token === undefined ? {} : { token: value.token }) };
  } catch {
    return undefined;
  }
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mtimeMs === right.mtimeMs && left.size === right.size;
}

async function removeOldMalformedRecord(path: string, maximumAgeMs: number): Promise<boolean> {
  let observed: Stats;
  try {
    observed = await lstat(path);
  } catch {
    return false;
  }
  if (Date.now() - observed.mtimeMs <= maximumAgeMs) return false;

  let current: Stats;
  try {
    current = await lstat(path);
  } catch {
    return false;
  }
  if (!sameFile(observed, current) || Date.now() - current.mtimeMs <= maximumAgeMs) return false;
  await rm(path, { force: true });
  return true;
}

async function removeOwnedRecord(path: string, expected: LockRecord): Promise<void> {
  const current = await readLockRecord(path);
  if (current !== undefined && recordKey(current) === recordKey(expected)) await rm(path, { force: true });
}

async function removeStaleRecord(path: string, maximumAgeMs?: number): Promise<boolean> {
  const observed = await readLockRecord(path);
  if (observed === undefined) return removeOldMalformedRecord(path, maximumAgeMs ?? MALFORMED_STALE_MS);
  if (!stale(observed, maximumAgeMs)) return false;

  // Re-read immediately before unlinking so a replacement owner is not removed
  // merely because the previous record was stale.
  const current = await readLockRecord(path);
  if (current === undefined || recordKey(current) !== recordKey(observed) || !stale(current, maximumAgeMs)) return false;
  await rm(path, { force: true });
  return true;
}

async function createOwnedRecord(path: string): Promise<OwnedRecord> {
  const handle = await open(path, "wx");
  const record: LockRecord = { pid: process.pid, createdAt: new Date().toISOString(), token: randomUUID() };
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`);
    await handle.sync();
    return { handle, record };
  } catch (error) {
    await handle.close();
    await rm(path, { force: true });
    throw error;
  }
}

async function acquireGuard(lockPath: string): Promise<OwnedRecord> {
  const guardPath = `${lockPath}.acquire`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await createOwnedRecord(guardPath);
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error;
      if (attempt === 0 && await removeStaleRecord(guardPath, GUARD_STALE_MS)) continue;
      throw new TaskLockConflictError(lockPath);
    }
  }
  throw new TaskLockConflictError(lockPath);
}

async function acquireLock(lockPath: string): Promise<OwnedRecord> {
  const guardPath = `${lockPath}.acquire`;
  const guard = await acquireGuard(lockPath);
  try {
    try {
      return await createOwnedRecord(lockPath);
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error;
      if (!(await removeStaleRecord(lockPath))) throw new TaskLockConflictError(lockPath);
      return await createOwnedRecord(lockPath);
    }
  } finally {
    await guard.handle.close();
    await removeOwnedRecord(guardPath, guard.record);
  }
}

/** Serializes all read-modify-write operations for one task across processes. */
export async function withTaskLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true });
  const owned = await acquireLock(lockPath);
  try {
    return await operation();
  } finally {
    await owned.handle.close();
    await removeOwnedRecord(lockPath, owned.record);
  }
}
