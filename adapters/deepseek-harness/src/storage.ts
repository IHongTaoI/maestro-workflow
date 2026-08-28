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
   * @param statePath - project-relative path under `.maestro/`.
   */
  lockPathFor(statePath: string): string {
    const key = statePath.replace(/[\\/]+/g, '-').replace(/^\.maestro-/, '')
    return `${LOCK_ROOT}/${key}.lock`
  }
}

/**
 * Acquire an exclusive lock for a state path, returning a release function.
 *
 * NOTE: dsh's `FileSystem` seam currently exposes no delete/remove primitive,
 * so a lock file cannot be cleanly removed on release. Until that primitive
 * lands (or the adapter switches the lock to `ctx.storage`), callers should
 * treat locks as lease-based: write an owner + expiry into the lock file and
 * reclaim only after confirming the recorded owner is inactive, per
 * `storage.md` ("clock age alone is insufficient proof").
 *
 * @param store - the state store.
 * @param statePath - project-relative path under `.maestro/`.
 * @param owner - the acquiring actor's identifier.
 */
export async function acquireLock(
  store: MaestroStateStore,
  statePath: string,
  owner: string,
): Promise<() => void> {
  const lockPath = store.lockPathFor(statePath)
  const payload = JSON.stringify({ owner, acquiredAt: new Date().toISOString() })
  await store.createIfAbsent(lockPath, payload)
  // Release is a no-op here for the reason documented above; a future revision
  // deletes the lock file once `ctx.fs` exposes a remove operation.
  return () => {}
}
