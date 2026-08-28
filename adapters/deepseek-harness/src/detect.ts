/**
 * Capability detection and graceful-fallback decision for the adapter.
 *
 * The adapter uses `ctx.get()` rather than `inject` for every optional seam:
 * `inject` would make the plugin refuse to start when a seam is absent, but
 * Issue #14 requires the Core Skill to keep working without any harness
 * enhancement. `ctx.get()` returns `undefined` for a missing service, which is
 * exactly the signal the fallback path needs.
 *
 * @module @maestro-ai/dsh-adapter/detect
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Activation, Capabilities } from './types'

/**
 * Probe which dsh capability seams are mounted in this context.
 *
 * @param ctx - the Cordis context the plugin was applied with.
 * @returns a {@link Capabilities} record; only `skills` is required.
 */
export function detectCapabilities(ctx: Context): Capabilities {
  return {
    skills: ctx.get('skills') !== undefined,
    fs: ctx.get('fs') !== undefined,
    agents: ctx.get('agents') !== undefined,
    persistence: ctx.get('sessionPersistence') !== undefined,
  }
}

/**
 * Guard the one hard requirement. A missing skill registry cannot be worked
 * around by the fallback path, so fail fast with an actionable message.
 *
 * @param capabilities - the result of {@link detectCapabilities}.
 */
export function assertSkills(capabilities: Capabilities): void {
  if (!capabilities.skills) {
    throw new Error(
      '@maestro-ai/dsh-adapter requires the dsh skill registry (`ctx.skills`). ' +
        'Load a profile that includes the skill plugin (dsh-base ships it).',
    )
  }
}

/**
 * Resolve the enhancement paths from detected capabilities. The result is
 * pure data; `index.ts` mounts exactly the plugins this decision selects.
 *
 * @param capabilities - the result of {@link detectCapabilities}.
 * @returns the {@link Activation} plan.
 */
export function planActivation(capabilities: Capabilities): Activation {
  const skill = capabilities.skills
  const storage = capabilities.fs
  const hooks = capabilities.agents
  return {
    skill,
    storage,
    hooks,
    degraded: !storage && !hooks,
  }
}
