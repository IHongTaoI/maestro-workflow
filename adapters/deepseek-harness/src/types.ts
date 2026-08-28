/**
 * Shared types for the Maestro DeepSeek Harness adapter.
 *
 * This module deliberately imports nothing from `@deepseek-ai/*`: the config
 * and capability shapes are host-independent so the adapter's own logic stays
 * testable without a live dsh runtime.
 *
 * @module @maestro-ai/dsh-adapter/types
 */

/** Adapter configuration supplied by the Cordis profile / bundle. */
export interface AdapterConfig {
  /**
   * Absolute or cwd-relative path to the Maestro Core directory (the folder
   * that contains `SKILL.md`, `references/`, and `schemas/`). When omitted,
   * the adapter probes the default roots below.
   */
  coreDir?: string
}

/** Default probe order for the Maestro Core directory, relative to cwd. */
export const DEFAULT_CORE_DIRS = ['.dsh/skills/maestro', 'maestro'] as const

/**
 * The dsh capability seams the adapter can build on. `skills` is mandatory
 * (nothing works without a skill registry); every other seam is optional and
 * gates an enhancement path only.
 */
export interface Capabilities {
  /** `ctx.skills` — skill registry (required). */
  skills: boolean
  /** `ctx.fs` — filesystem seam; enables the deterministic state store. */
  fs: boolean
  /** `ctx.agents` — agent registry; enables session-lifecycle hooks. */
  agents: boolean
  /** `ctx.sessionPersistence` — durable session store (future use). */
  persistence: boolean
}

/** What the adapter actually activated, derived from {@link Capabilities}. */
export interface Activation {
  /** Core skill was registered (always true when `skills` is present). */
  skill: boolean
  /** Deterministic state store was mounted (requires `fs`). */
  storage: boolean
  /** Session-lifecycle hooks were mounted (requires `agents`). */
  hooks: boolean
  /** Whether the adapter degraded to the plain-skill fallback. */
  degraded: boolean
}

/** Minimal parsed frontmatter from a Maestro `SKILL.md`. */
export interface SkillFrontmatter {
  name: string
  description: string
}
