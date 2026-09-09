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
 * - **Product B**: when `ctx.fs` exists, the deterministic
 *   `MaestroStateStore` and `MaestroSchemaValidator` are constructed and
 *   registered as Cordis services (`maestro.stateStore` /
 *   `maestro.schemaValidator`). They are reachable via `ctx.get(...)` but are
 *   not exposed as unrestricted raw tools. A session-bound checkpoint
 *   tool uses them for single-target snapshot saves when `ctx.tools` exists.
 *   Other Core reads/writes still follow `storage.md` through host tools.
 * - **Lifecycle hooks**: `ctx.agents` is detected for status only; no handler
 *   is registered yet because Maestro's Handoff / session-boundary decision
 *   logic lives in the Core Skill and has not been implemented.
 *
 * @module @maestro-ai/dsh-adapter
 */

import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { checkpointTool } from './checkpoint-tool'
import { assertSkills, detectCapabilities, planActivation } from './detect'
import { loadCoreSkill, registerCoreSkill, resolveCoreDir } from './skill'
import { MaestroStateStore } from './storage'
import { MaestroSchemaValidator } from './validate'
import type { AdapterConfig } from './types'

/** Cordis plugin name. */
export const name = 'maestro-adapter'

/** Only skills gate the Core; child injections wait for optional enhancements. */
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
  const checkpoint = config.checkpoint === false ? false : config.checkpoint ?? {}
  const capabilities = detectCapabilities(ctx)
  assertSkills(capabilities)
  const activation = planActivation(capabilities)

  // Product A — register the portable Maestro Core Skill. This always runs.
  const coreDir = await resolveCoreDir(config, process.cwd())
  const registration = await loadCoreSkill(coreDir)
  const disposer = registerCoreSkill(ctx, registration)
  ctx.effect(() => disposer, 'maestro-adapter: core skill')

  // Do not snapshot optional services at startup: DSH can publish fs/tools later.
  // Child injections preserve the plain Skill and follow service disposal/reload.
  ctx.inject(['fs'], async (ctx) => {
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
    // The optional checkpoint tool below exposes a bounded validated workflow;
    // arbitrary Core storage operations are not automatically routed through it.
    const disposeValidator = ctx.provide(SCHEMA_VALIDATOR_SERVICE, validator)
    const disposeStore = ctx.provide(STATE_STORE_SERVICE, store)
    ctx.effect(() => () => {
      disposeStore()
      disposeValidator()
    }, 'maestro-adapter: storage services')

    if (checkpoint && validator.has('https://maestro.local/schemas/checkpoint.schema.json')) {
      if ((checkpoint.projectRoot !== undefined && !path.isAbsolute(checkpoint.projectRoot))
        || (checkpoint.recoveryRoot !== undefined && !path.isAbsolute(checkpoint.recoveryRoot))) {
        throw new Error('maestro-adapter: checkpoint roots must be absolute operator configuration')
      }
      ctx.inject(['tools'], (ctx) => {
        const tools = ctx.get('tools') as ToolRuntime
        const disposeCheckpoint = tools.register(checkpointTool(fs, validator, checkpoint))
        ctx.effect(() => disposeCheckpoint, 'maestro-adapter: checkpoint tool')
        ctx.logger.info('maestro-adapter: checkpoint tool registered (snapshot mode; live durability not verified)')
      })
    } else if (checkpoint) {
      ctx.logger.warn('maestro-adapter: checkpoint not activated; tools or schemas unavailable')
    }
  })
  if (checkpoint && !activation.storage) {
    ctx.logger.info('maestro-adapter: checkpoint waiting for filesystem service')
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
