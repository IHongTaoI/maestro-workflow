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
 * ## What is actually wired today
 *
 * - **Product A (complete)**: the Maestro Core Skill is registered.
 * - **Product B (mechanism only)**: when `ctx.fs` exists, the deterministic
 *   `MaestroStateStore` and `MaestroSchemaValidator` are constructed and
 *   registered as Cordis services (`maestro.stateStore` /
 *   `maestro.schemaValidator`). They are reachable via `ctx.get(...)` but are
 *   **not yet exposed as a model-facing tool**, so the Core Skill's storage
 *   protocol does not yet flow through them — the Core still drives its own
 *   reads/writes by following `storage.md` in prose. Wiring a tool (or other
 *   model-visible seam) is the remaining `TODO(next)`.
 * - **Lifecycle hooks**: `ctx.agents` is detected for status only; no handler
 *   is registered yet because Maestro's Handoff / session-boundary decision
 *   logic lives in the Core Skill and has not been implemented.
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
import type { AdapterConfig } from './types'

/** Cordis plugin name. */
export const name = 'maestro-adapter'

/** Hard dependency: the skill registry. Optional seams are probed, not injected. */
export const inject = ['skills']

/** Cordis service name under which the deterministic state store is provided. */
export const STATE_STORE_SERVICE = 'maestro.stateStore'

/** Cordis service name under which the schema validator is provided. */
export const SCHEMA_VALIDATOR_SERVICE = 'maestro.schemaValidator'

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

    // Provide both as Cordis services so the rest of the runtime can reach them.
    // TODO(next): also expose the store (and validator) as a model-facing tool,
    // so the Core's storage protocol runs through this CAS implementation rather
    // than the model following storage.md in prose.
    const disposeValidator = ctx.provide(SCHEMA_VALIDATOR_SERVICE, validator)
    const disposeStore = ctx.provide(STATE_STORE_SERVICE, store)
    ctx.effect(() => () => {
      disposeStore()
      disposeValidator()
    }, 'maestro-adapter: storage services')
  }

  // TODO(next): when Maestro's Handoff / session-boundary logic lands in the
  // Core Skill, wire it here via registerLifecycleHooks(ctx, { onTurnStopping })
  // (see src/hooks.ts). The trigger is deterministic; the decision stays in the
  // Core. No no-op handler is registered today.

  ctx.logger.info(
    `maestro-adapter: registered skill "${registration.name}" ` +
      `(storage=${activation.storage}, hooks=${activation.hooks}, degraded=${activation.degraded})`,
  )
}

export default apply
