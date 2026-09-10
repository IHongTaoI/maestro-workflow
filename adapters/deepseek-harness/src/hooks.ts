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
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { AutoCheckpointConfig } from './types'

const AUTO_SOURCE = 'maestro-auto-checkpoint'
const DEFAULT_PRESSURE_THRESHOLD = 0.72
const DEFAULT_COOLDOWN_TURNS = 2
const DEFAULT_TIMEOUT_MS = 1_000

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

export interface LifecycleHookOptions {
  timeoutMs?: number
}

export type AutoCheckpointDecision =
  | 'triggered'
  | 'below-threshold'
  | 'pressure-unknown'
  | 'no-new-progress'
  | 'cooldown'
  | 'cancelled'

interface CheckpointObservation {
  seq: number
  turn: number
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number,
  name: string): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < min || selected > max) {
    throw new Error(`maestro-adapter: ${name} must be an integer from ${min} to ${max}`)
  }
  return selected
}

function pressureThreshold(value: number | undefined): number {
  const selected = value ?? DEFAULT_PRESSURE_THRESHOLD
  if (!Number.isFinite(selected) || selected < 0.5 || selected > 0.95) {
    throw new Error('maestro-adapter: checkpoint.auto.pressureThreshold must be from 0.5 to 0.95')
  }
  return selected
}

function nestedText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap((block) => {
    if (!block || typeof block !== 'object') return []
    const item = block as { type?: unknown; text?: unknown; content?: unknown }
    if (item.type === 'text' && typeof item.text === 'string') return [item.text]
    if (item.type === 'tool-result') return [nestedText(item.content)]
    return []
  }).join('')
}

function checkpointCalls(events: readonly SessionEvent[]): Map<string, { seq: number; turn: number }> {
  const calls = new Map<string, { seq: number; turn: number }>()
  for (const event of events) {
    if (event?.type !== 'tool/call' || event.data?.name !== 'maestro_checkpoint') continue
    try {
      const args = JSON.parse(event.data.arguments) as { operation?: unknown }
      if (args.operation === 'save' || args.operation === 'retry') {
        calls.set(String(event.data.callId), { seq: event.seq, turn: event.data.turn })
      }
    } catch {
      // Invalid model arguments are not a checkpoint observation.
    }
  }
  return calls
}

function lastCommittedCheckpoint(events: readonly SessionEvent[]): CheckpointObservation | undefined {
  const calls = checkpointCalls(events)
  let found: CheckpointObservation | undefined
  for (const event of events) {
    if (event?.type !== 'tool/result') continue
    const block = event.data?.message?.content?.[0]
    const call = calls.get(String(block?.toolCallId))
    if (!call || block?.isError) continue
    try {
      const result = JSON.parse(nestedText(block.content)) as { status?: unknown }
      if (result.status === 'committed' || result.status === 'already_committed') {
        found = { seq: event.seq, turn: call.turn }
      }
    } catch {
      // A non-JSON or differently rendered result cannot prove commit success.
    }
  }
  return found
}

function autoPrompt(event: SessionEvent): { seq: number; turn: number } | undefined {
  if (event?.type !== 'user/message') return undefined
  const plugin = event.data?.source?.kind === 'plugin' ? event.data.source.plugin : undefined
  const match = typeof plugin === 'string'
    ? new RegExp(`^${AUTO_SOURCE}/turn-(\\d+)$`).exec(plugin) : null
  return match ? { seq: event.seq, turn: Number(match[1]) } : undefined
}

function lastAutoPrompt(events: readonly SessionEvent[]): CheckpointObservation | undefined {
  let found: CheckpointObservation | undefined
  for (const event of events) found = autoPrompt(event) ?? found
  return found
}

function lastProgressSeq(events: readonly SessionEvent[], checkpointCallIds: ReadonlySet<string>): number {
  let seq = -1
  for (const event of events) {
    if (event?.type === 'user/message' && !autoPrompt(event)) seq = event.seq
    if (event?.type === 'tool/result') {
      const callId = String(event.data?.message?.content?.[0]?.toolCallId)
      if (!checkpointCallIds.has(callId)) seq = event.seq
    }
  }
  return seq
}

interface ContextPressureProjection {
  projectedTokens?: unknown
  contextWindow?: unknown
}

interface SessionProjectionReader {
  snapshot(session: Agent['session']): {
    values?: { contextPressure?: ContextPressureProjection }
  }
}

function projectedContextPressure(agent: Agent): number | undefined {
  const reader = agent.ctx?.get('sessionProjections') as SessionProjectionReader | undefined
  if (!reader || typeof reader.snapshot !== 'function') return undefined
  try {
    const projection = reader.snapshot(agent.session).values?.contextPressure
    const tokens = projection?.projectedTokens
    const window = projection?.contextWindow
    if (!Number.isFinite(tokens) || !Number.isFinite(window)
      || (tokens as number) < 0 || (window as number) <= 0) return undefined
    return (tokens as number) / (window as number)
  } catch {
    // A missing/unavailable projection is an optional capability, so fall back.
    return undefined
  }
}

function estimatedNextRequestPressure(agent: Agent): number | undefined {
  const projected = projectedContextPressure(agent)
  if (projected !== undefined) return projected
  const window = agent.session.requestContext()?.contextWindow
  if (!Number.isFinite(window) || !window || window <= 0) return undefined
  const events = agent.session.events
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event.type !== 'assistant/message' || !event.data.usage) continue
    const usage = event.data.usage
    // Match DSH token-meter's prompt-side pressureTokens fallback. Output is
    // excluded because it is not part of the next request's prompt.
    const used = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    return used / window
  }
  return undefined
}

/**
 * Turn-boundary checkpoint trigger for DSH hosts that expose request capacity.
 * It does not claim to be pre-compaction: the configurable threshold is an
 * early-warning experiment that asks the current model to reuse the M1 tool.
 */
export class AutoCheckpointCoordinator {
  readonly threshold: number
  readonly cooldownTurns: number

  constructor(config: AutoCheckpointConfig = {}) {
    this.threshold = pressureThreshold(config.pressureThreshold)
    this.cooldownTurns = boundedInteger(config.cooldownTurns, DEFAULT_COOLDOWN_TURNS, 1, 100,
      'checkpoint.auto.cooldownTurns')
  }

  evaluateAndTrigger(payload: TurnStopPayload): AutoCheckpointDecision {
    if (payload.signal.aborted) return 'cancelled'
    const events = payload.agent.session.events
    const pressure = estimatedNextRequestPressure(payload.agent)
    if (pressure === undefined) return 'pressure-unknown'
    if (pressure < this.threshold) return 'below-threshold'

    const calls = checkpointCalls(events)
    const committed = lastCommittedCheckpoint(events)
    const prompted = lastAutoPrompt(events)
    const boundary = Math.max(committed?.seq ?? -1, prompted?.seq ?? -1)
    if (lastProgressSeq(events, new Set(calls.keys())) <= boundary) return 'no-new-progress'

    const lastTurn = Math.max(committed?.turn ?? -Infinity, prompted?.turn ?? -Infinity)
    if (payload.turn - lastTurn < this.cooldownTurns) return 'cooldown'
    payload.signal.throwIfAborted()

    const percent = Math.round(pressure * 100)
    payload.agent.steer(createUserMessage({
      content: [{
        type: 'text',
        text: [
          `Maestro 自动 checkpoint 触发：预计下一次模型请求约占上下文窗口 ${percent}%，达到配置阈值。`,
          '这是 DSH 的真实 turn-stopping 压力提醒，不是 pre-compaction 事件。',
          '请先判断当前工作是否产生了值得恢复的新进展。若有，只选择当前相关且已存在的活动 Temporary 或 Task，调用 maestro_checkpoint：先 inspect，再用同一 revision/hash 执行 save；失败时保留同一 request_id 并按 status/retry 处理。',
          '不要创建新 Task，不要恢复无关旧任务，不要扩大权限，也不要向用户展开保存过程。若没有可安全选择的活动目标，则跳过并继续正常结束。',
        ].join('\n'),
      }],
      source: {
        kind: 'plugin',
        plugin: `${AUTO_SOURCE}/turn-${payload.turn}`,
        form: 'notice',
        summary: '上下文压力达到阈值，先检查是否需要保存 Maestro checkpoint。',
      },
    }))
    return 'triggered'
  }
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
export function registerLifecycleHooks(ctx: Context, handlers: LifecycleHandlers,
  options: LifecycleHookOptions = {}): void {
  const onTurnStopping = handlers.onTurnStopping
  if (onTurnStopping === undefined) return
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 50, 5_000,
    'checkpoint.auto.timeoutMs')
  ctx.on(
    'agent/turn-stopping',
    function (payload) {
      const timeout = new AbortController()
      const signal = AbortSignal.any([payload.signal, timeout.signal])
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          timeout.abort(new Error('lifecycle hook timeout'))
          ctx.logger.warn(`maestro-adapter: onTurnStopping listener timed out after ${timeoutMs}ms`)
          resolve()
        }, timeoutMs)
      })
      const handled = Promise.resolve()
        .then(() => onTurnStopping({ ...payload, signal }))
        .catch((error: unknown) => {
          ctx.logger.warn(`maestro-adapter: onTurnStopping listener failed: ${String(error)}`)
        })
      return Promise.race([handled, deadline]).finally(() => {
        if (timer !== undefined) clearTimeout(timer)
      })
    },
    { global: true },
  )
}
