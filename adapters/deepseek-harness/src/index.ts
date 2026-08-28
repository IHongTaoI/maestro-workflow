/**
 * Maestro DeepSeek Harness adapter — the single Cordis plugin entry point.
 *
 * This is the only module that imports dsh packages, so a dsh API change
 * (dsh is a v0.1 preview with an explicit "compatibility-breaking changes"
 * warning) is contained to this one file plus the type-only imports in the
 * other `src/*.ts` modules.
 *
 * Flow: detect capabilities → fail fast if skills are missing → register the
 * Maestro Core Skill → mount the enhancement paths that the detected seams
 * support. When `ctx.fs` / `ctx.agents` are absent the adapter degrades to the
 * plain-skill fallback and the Core still works.
 *
 * @module @maestro-ai/dsh-adapter
 */

import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { assertSkills, detectCapabilities, planActivation } from './detect'
import { loadCoreSkill, registerCoreSkill, resolveCoreDir } from './skill'
import { MaestroStateStore } from './storage'
import { MaestroSchemaValidator } from './validate'
import { registerLifecycleHooks } from './hooks'
import type { AdapterConfig } from './types'

/** Cordis plugin name. */
export const name = 'maestro-adapter'

/** Hard dependency: the skill registry. Optional seams are probed, not injected. */
export const inject = ['skills']

/**
 * Mount the adapter. Async because it reads `SKILL.md` from disk during setup.
 *
 * @param ctx - the Cordis context.
 * @param config - adapter config (see {@link AdapterConfig}).
 */
export async function apply(ctx: Context, config: AdapterConfig = {}): Promise<void> {
  const capabilities = detectCapabilities(ctx)
  assertSkills(capabilities)
  const activation = planActivation(capabilities)

  // Product A — register the portable Maestro Core Skill. This always runs.
  const coreDir = await resolveCoreDir(config, process.cwd())
  const registration = await loadCoreSkill(coreDir)
  const disposer = registerCoreSkill(ctx, registration)
  ctx.effect(() => disposer, 'maestro-adapter: core skill')

  // Product B — mount deterministic enhancements only where the seams exist.
  if (activation.storage) {
    const fs = ctx.get('fs') as FileSystem
    const store = new MaestroStateStore(fs)
    const validator = new MaestroSchemaValidator()
    const schemaCount = await validator.loadAll(path.join(coreDir, 'references', 'schemas'))
    if (schemaCount === 0) {
      ctx.logger.warn(
        'maestro-adapter: no JSON Schemas loaded from references/schemas; validation stays disabled',
      )
    }
    // TODO(next): expose `store`/`validator` to the runtime — either register a
    // model-facing tool on `ctx.tools` (so the Core's storage protocol runs
    // through this CAS implementation) or provide them as a Cordis service.
    void store
    void validator
  }

  if (activation.hooks) {
    registerLifecycleHooks(ctx, {
      // TODO(next): drive Maestro's Handoff / session-boundary checks from this
      // deterministic trigger; the decision logic stays in the Core Skill.
      onTurnStopping: () => {},
    })
  }

  ctx.logger.info(
    `maestro-adapter: registered skill "${registration.name}" ` +
      `(storage=${activation.storage}, hooks=${activation.hooks}, degraded=${activation.degraded})`,
  )
}

export default apply
