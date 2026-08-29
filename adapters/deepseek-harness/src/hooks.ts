/**
 * Session-lifecycle hooks (capability plugin, skeleton): observe dsh agent
 * events and hand the adapter a deterministic, host-specific trigger for
 * Maestro's Handoff / session-boundary checks.
 *
 * The boundary is deliberate: the adapter only decides *when* a hook fires
 * (a turn stopping, a session starting). It never decides *what* Maestro does
 * with that signal — that stays in the Core Skill. This module is a mount
 * point, not business logic.
 *
 * dsh dispatches `agent/*` events scope-filtered (`this: Scoped<Agent>`), so a
 * root-context listener registers with `{ global: true }` to observe every
 * agent rather than one scoped agent. `agent/turn-stopping` is serial and has
 * no `next()`.
 *
 * @module @maestro-ai/dsh-adapter/hooks
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** Payload of dsh's `agent/turn-stopping` event (see dsh-agent runtime-types). */
export interface TurnStopPayload {
  agent: Agent
  turn: number
  signal: AbortSignal
}

/** Callbacks the adapter can invoke at deterministic lifecycle boundaries. */
export interface LifecycleHandlers {
  /** Invoked when a turn is about to close. */
  onTurnStopping?: (payload: TurnStopPayload) => void | Promise<void>
}

/**
 * Register lifecycle listeners on the context. Cordis removes listeners when
 * the context is disposed, so no manual disposer is returned.
 *
 * `agent/turn-stopping` is a `@mode serial` event: the dispatcher awaits each
 * listener in order before the turn boundary commits. The listener therefore
 * **returns** the handler promise (wrapped so errors are logged, not thrown)
 * instead of fire-and-forgetting it — otherwise a turn could close while a
 * Handoff / memory save is still in flight.
 *
 * @param ctx - the Cordis context.
 * @param handlers - the callbacks to wire up.
 */
export function registerLifecycleHooks(ctx: Context, handlers: LifecycleHandlers): void {
  const onTurnStopping = handlers.onTurnStopping
  if (onTurnStopping === undefined) return
  ctx.on(
    'agent/turn-stopping',
    function (payload) {
      return Promise.resolve(onTurnStopping(payload)).catch((error: unknown) => {
        ctx.logger.warn(`maestro-adapter: onTurnStopping listener failed: ${String(error)}`)
      })
    },
    { global: true },
  )
}
