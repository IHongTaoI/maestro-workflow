/**
 * Deterministic state store (capability plugin): map Maestro's mutable-state
 * write protocol from `references/storage.md` onto dsh's `ctx.fs` primitives.
 *
 * The key realisation from reading dsh's `FileSystem` seam: `writeText` with a
 * `replaceIfVersion` intent is already a compare-and-swap, and `createIfAbsent`
 * is an exclusive create. These two primitives let the adapter implement
 * Maestro's "read → guard → atomically replace" protocol as optimistic
 * concurrency, with the opaque `FsVersion` playing the role of the freshness
 * token.
 *
 * The adapter owns only the *mechanism*. The Maestro Core (the skill) still
 * decides what the `revision` / `updated_at` / `updated_by` fields inside the
 * file mean — it reads a snapshot, edits the content, and calls
 * {@link writeGuarded}. The store never interprets those fields.
 *
 * @module @maestro-ai/dsh-adapter/storage
 */

import type {
  FileSystem,
  FsTarget,
  FsVersion,
  FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'

/** The lock root inside a project's Maestro state directory. */
const LOCK_ROOT = '.maestro/locks'

/**
 * A point-in-time read of a mutable state file: its resolved target, its
 * opaque freshness token (the CAS guard), and its decoded text content.
 */
export interface StateSnapshot {
  /** Resolved target for follow-up operations. */
  target: FsTarget
  /** Opaque version token used by {@link writeGuarded}. */
  version: FsVersion
  /** Decoded UTF-8 content at read time. */
  content: string
}

/**
 * Deterministic state store over the dsh filesystem seam.
 *
 * Not a Cordis service class on purpose: the adapter keeps its dsh-facing
 * surface in `index.ts` and passes a bare `FileSystem` here so the CAS logic
 * stays unit-testable against a fake seam.
 */
export class MaestroStateStore {
  constructor(private readonly fs: FileSystem) {}

  /**
   * Resolve a project-relative state path into a stable target.
   * @param statePath - project-relative path under `.maestro/`.
   */
  resolve(statePath: string): Promise<FsTarget> {
    return this.fs.resolve(statePath)
  }

  /**
   * Read a mutable state file, capturing both its content and its freshness
   * token. Returns `undefined` when the file does not exist.
   *
   * @param statePath - project-relative path under `.maestro/`.
   */
  async readSnapshot(statePath: string): Promise<StateSnapshot | undefined> {
    const target = await this.fs.resolve(statePath)
    const info = await this.fs.stat(target)
    if (info === undefined) return undefined
    const content = await this.fs.readText(target)
    return { target, version: info.version, content }
  }

  /**
   * Atomically replace a state file only if it still matches the snapshot the
   * caller read. A concurrent write makes the seam throw `FS_STALE_VERSION`;
   * the caller re-reads and retries (or surfaces the conflict), exactly as
   * `storage.md` prescribes for a revision mismatch.
   *
   * @param snapshot - the {@link readSnapshot} result the edit was based on.
   * @param content - the complete replacement text.
   */
  writeGuarded(snapshot: StateSnapshot, content: string): Promise<FsWriteOutcome> {
    return this.fs.writeText(snapshot.target, content, { kind: 'replaceIfVersion', version: snapshot.version })
  }

  /**
   * Atomically create a file, failing if it already exists. This is the
   * exclusive create-if-absent primitive Maestro's lock protocol needs.
   *
   * @param statePath - project-relative path under `.maestro/`.
   * @param content - lock owner / lease metadata.
   */
  async createIfAbsent(statePath: string, content: string): Promise<FsWriteOutcome> {
    const target = await this.fs.resolve(statePath)
    return this.fs.writeText(target, content, { kind: 'createIfAbsent' })
  }

  /**
   * Derive the stable lock path for a state path. Mirrors `storage.md`: a
   * normalized project-relative state key maps to a dedicated lock entry.
   *
   * The state path is normalized (backslashes, leading `./`, `.maestro/`
   * prefix) before mapping, and traversal is rejected outright per the File
   * rules in `storage.md` — a `..` segment must never silently collapse into
   * a lock name.
   *
   * @param statePath - project-relative path under `.maestro/`.
   * @throws when the path escapes the project root or is absolute.
   */
  lockPathFor(statePath: string): string {
    const normalized = statePath.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
    const segments = normalized.split('/')
    if (
      normalized.startsWith('/') ||
      /^[A-Za-z]:/.test(normalized) ||
      segments.some((segment) => segment === '..')
    ) {
      throw new Error(
        `@maestro-ai/dsh-adapter: invalid state path "${statePath}" — absolute paths and ` +
          '`..` traversal are rejected per storage.md File rules.',
      )
    }
    const key = normalized.replace(/^\.maestro\//, '').replace(/\/+/g, '-')
    return `${LOCK_ROOT}/${key}.lock`
  }
}

/** Lease metadata recorded inside a lock file. */
export interface LockLease {
  owner: string
  acquiredAt: string
  expiresAt: string
}

/** Tunables for {@link acquireLock}. */
export interface AcquireLockOptions {
  /** Lease lifetime in milliseconds (default 5 minutes). */
  leaseMs?: number
  /** Bounded contention window in milliseconds (default 30 seconds). */
  timeoutMs?: number
  /** Delay between contention retries in milliseconds (default 250). */
  retryDelayMs?: number
}

const DEFAULT_LEASE_MS = 5 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 30 * 1000
const DEFAULT_RETRY_DELAY_MS = 250

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Best-effort check for the seam's "already exists" signal. */
function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'FS_NOT_OBSERVED'
  )
}

function parseLease(content: string): LockLease | undefined {
  try {
    const parsed = JSON.parse(content) as Partial<LockLease>
    if (
      typeof parsed.owner === 'string' &&
      typeof parsed.acquiredAt === 'string' &&
      typeof parsed.expiresAt === 'string'
    ) {
      return parsed as LockLease
    }
  } catch {
    // Unparseable lock content is treated as reclaimable below.
  }
  return undefined
}

/**
 * Acquire an exclusive lock for a state path, returning a release function.
 *
 * dsh's `FileSystem` seam currently exposes no delete/remove primitive, so a
 * lock file cannot be cleanly removed on release. The lock is therefore
 * lease-based: every acquisition writes `owner` + `expiresAt`, and an
 * existing lock is reclaimed only after its recorded lease has expired. The
 * reclaim itself is a compare-and-swap ({@link MaestroStateStore.writeGuarded})
 * against the exact snapshot that was read, so two concurrent reclaimers
 * cannot both win — the loser's `FS_STALE_VERSION` sends it back to retry.
 *
 * Per `storage.md`, "clock age alone is insufficient proof that an owner is
 * inactive": the caller remains responsible for confirming the prior owner is
 * gone before relying on a reclaimed lock, and for recording the reclaim in a
 * transaction or Evidence record.
 *
 * @param store - the state store.
 * @param statePath - project-relative path under `.maestro/`.
 * @param owner - the acquiring actor's identifier.
 * @param options - lease/contention tunables.
 * @throws on lock contention past the bounded timeout.
 */
export async function acquireLock(
  store: MaestroStateStore,
  statePath: string,
  owner: string,
  options: AcquireLockOptions = {},
): Promise<() => void> {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const lockPath = store.lockPathFor(statePath)

  for (;;) {
    const now = Date.now()
    const payload = JSON.stringify({
      owner,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + leaseMs).toISOString(),
    } satisfies LockLease)

    try {
      await store.createIfAbsent(lockPath, payload)
      // Release stays a no-op until `ctx.fs` exposes a remove operation; an
      // expired lease is what makes the lock reusable.
      return () => {}
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }

    // The lock file exists. Reclaim it only when the recorded lease expired.
    const snapshot = await store.readSnapshot(lockPath)
    if (snapshot !== undefined) {
      const lease = parseLease(snapshot.content)
      const expired = lease === undefined || Date.parse(lease.expiresAt) <= now
      if (expired) {
        try {
          await store.writeGuarded(snapshot, payload)
          return () => {}
        } catch (error) {
          // A concurrent reclaimer beat us to it; fall through to retry.
          if (!isAlreadyExists(error)) {
            const code = (error as { code?: unknown })?.code
            if (code !== 'FS_STALE_VERSION') throw error
          }
        }
      }
    }

    if (Date.now() + retryDelayMs > deadline) {
      throw new Error(
        `@maestro-ai/dsh-adapter: lock contention on "${statePath}" — still held after ` +
          `${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms. Never force the write; surface the conflict per storage.md.`,
      )
    }
    await sleep(retryDelayMs)
  }
}
