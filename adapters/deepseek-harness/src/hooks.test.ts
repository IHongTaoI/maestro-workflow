import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AutoCheckpointCoordinator, registerLifecycleHooks } from './hooks'
import type { LifecycleHandlers, TurnStopPayload } from './hooks'

interface ListenerRecord {
  name: string
  listener: (payload: unknown) => unknown
  options: { global?: boolean }
}

/** Minimal fake Cordis context capturing `ctx.on` calls and log warnings. */
function makeCtx() {
  const listeners: ListenerRecord[] = []
  const warnings: unknown[][] = []
  return {
    on(name: string, listener: (payload: unknown) => unknown, options?: { global?: boolean }) {
      listeners.push({ name, listener, options: options ?? {} })
      return () => false
    },
    logger: {
      warn: (...args: unknown[]) => {
        warnings.push(args)
      },
    },
    listeners,
    warnings,
  }
}

const payload: TurnStopPayload = { agent: {} as never, turn: 1, signal: new AbortController().signal }

function autoFixture(contextWindow = 1000) {
  const events: any[] = [
    { seq: 0, type: 'user/message', data: { source: { kind: 'user' } } },
    { seq: 1, type: 'assistant/message', data: { usage: { inputTokens: 750, outputTokens: 100 } } },
  ]
  const steered: any[] = []
  const agent = {
    session: { events, requestContext: () => ({ contextWindow }) },
    steer(message: any) {
      steered.push(message)
      events.push({ seq: events.length, type: 'user/message', data: message })
    },
  }
  return { events, steered, agent: agent as never }
}

test('registerLifecycleHooks registers nothing when no handler is given', () => {
  const ctx = makeCtx()
  const handlers: LifecycleHandlers = {}
  registerLifecycleHooks(ctx as never, handlers)
  assert.equal(ctx.listeners.length, 0)
})

test('registerLifecycleHooks listens on agent/turn-stopping with global scope', () => {
  const ctx = makeCtx()
  registerLifecycleHooks(ctx as never, { onTurnStopping: () => {} })
  assert.equal(ctx.listeners.length, 1)
  assert.equal(ctx.listeners[0].name, 'agent/turn-stopping')
  assert.equal(ctx.listeners[0].options.global, true)
})

test('the listener returns a promise that is resolved only after the handler settles', async () => {
  const ctx = makeCtx()
  let finished = false
  registerLifecycleHooks(ctx as never, {
    onTurnStopping: async () => {
      await new Promise((r) => setTimeout(r, 20))
      finished = true
    },
  })
  const returned = ctx.listeners[0].listener(payload)
  assert.ok(returned instanceof Promise, 'listener must return a Promise for the serial dispatcher to await')
  assert.equal(finished, false, 'handler must not have completed synchronously')
  await returned
  assert.equal(finished, true)
})

test('a rejecting handler is swallowed and logged, not re-thrown', async () => {
  const ctx = makeCtx()
  registerLifecycleHooks(ctx as never, {
    onTurnStopping: async () => {
      throw new Error('boom')
    },
  })
  const returned = ctx.listeners[0].listener(payload)
  await returned // must resolve, not reject
  assert.equal(ctx.warnings.length, 1)
  assert.match(String(ctx.warnings[0][0]), /onTurnStopping listener failed/)
})

test('a synchronously throwing handler is swallowed and logged', async () => {
  const ctx = makeCtx()
  registerLifecycleHooks(ctx as never, {
    onTurnStopping: () => {
      throw new Error('sync boom')
    },
  })
  await ctx.listeners[0].listener(payload)
  assert.equal(ctx.warnings.length, 1)
  assert.match(String(ctx.warnings[0][0]), /onTurnStopping listener failed/)
})

test('the serial lifecycle wait is bounded and aborts the handler signal', async () => {
  const ctx = makeCtx()
  let aborted = false
  registerLifecycleHooks(ctx as never, {
    onTurnStopping: ({ signal }) => new Promise<void>(() => {
      signal.addEventListener('abort', () => { aborted = true })
    }),
  }, { timeoutMs: 50 })
  const started = Date.now()
  await ctx.listeners[0].listener(payload)
  assert.ok(Date.now() - started < 500)
  assert.equal(aborted, true)
  assert.match(String(ctx.warnings[0][0]), /timed out after 50ms/)
})

test('automatic checkpoint triggers from measured pressure and records a bounded plugin prompt', () => {
  const f = autoFixture()
  const coordinator = new AutoCheckpointCoordinator({ pressureThreshold: 0.7 })
  const decision = coordinator.evaluateAndTrigger({ agent: f.agent, turn: 3,
    signal: new AbortController().signal })
  assert.equal(decision, 'triggered')
  assert.equal(f.steered.length, 1)
  assert.equal(f.steered[0].source.plugin, 'maestro-auto-checkpoint/turn-3')
  assert.match(f.steered[0].content[0].text, /不是 pre-compaction/)
  assert.match(f.steered[0].content[0].text, /先 inspect/)
})

test('automatic checkpoint stays quiet without measurable pressure or below threshold', () => {
  const missing = autoFixture(0)
  const coordinator = new AutoCheckpointCoordinator({ pressureThreshold: 0.8 })
  assert.equal(coordinator.evaluateAndTrigger({ agent: missing.agent, turn: 1,
    signal: new AbortController().signal }), 'pressure-unknown')
  const low = autoFixture(2000)
  assert.equal(coordinator.evaluateAndTrigger({ agent: low.agent, turn: 1,
    signal: new AbortController().signal }), 'below-threshold')
  assert.equal(missing.steered.length + low.steered.length, 0)
})

test('automatic checkpoint prefers DSH projected pressure and excludes output in usage fallback', () => {
  const projected = autoFixture(10_000)
  const projectedAgent = projected.agent as unknown as { ctx?: unknown }
  projectedAgent.ctx = { get: (name: string) => name === 'sessionProjections' ? {
    snapshot: () => ({ values: { contextPressure: { projectedTokens: 850, contextWindow: 1000 } } }),
  } : undefined } as never
  const coordinator = new AutoCheckpointCoordinator({ pressureThreshold: 0.8 })
  assert.equal(coordinator.evaluateAndTrigger({ agent: projected.agent, turn: 1,
    signal: new AbortController().signal }), 'triggered')

  const fallback = autoFixture(1000)
  fallback.events[1].data.usage = { inputTokens: 650, outputTokens: 500 }
  assert.equal(coordinator.evaluateAndTrigger({ agent: fallback.agent, turn: 1,
    signal: new AbortController().signal }), 'below-threshold')
})

test('automatic checkpoint deduplicates a trigger and observes cooldown after commit', () => {
  const f = autoFixture()
  const coordinator = new AutoCheckpointCoordinator({ pressureThreshold: 0.7, cooldownTurns: 2 })
  assert.equal(coordinator.evaluateAndTrigger({ agent: f.agent, turn: 3,
    signal: new AbortController().signal }), 'triggered')
  assert.equal(coordinator.evaluateAndTrigger({ agent: f.agent, turn: 3,
    signal: new AbortController().signal }), 'no-new-progress')

  f.events.push({ seq: f.events.length, type: 'tool/call', data: { turn: 3, callId: 'checkpoint-1',
    name: 'maestro_checkpoint', arguments: JSON.stringify({ operation: 'save' }) } })
  f.events.push({ seq: f.events.length, type: 'tool/result', data: { message: { content: [{
    type: 'tool-result', toolCallId: 'checkpoint-1', content: [{ type: 'text', text: '{"status":"committed"}' }],
  }] } } })
  f.events.push({ seq: f.events.length, type: 'user/message', data: { source: { kind: 'user' } } })
  f.events.push({ seq: f.events.length, type: 'assistant/message', data: {
    usage: { inputTokens: 700, outputTokens: 80 } } })
  assert.equal(coordinator.evaluateAndTrigger({ agent: f.agent, turn: 4,
    signal: new AbortController().signal }), 'cooldown')

  f.events.push({ seq: f.events.length, type: 'user/message', data: { source: { kind: 'user' } } })
  assert.equal(coordinator.evaluateAndTrigger({ agent: f.agent, turn: 5,
    signal: new AbortController().signal }), 'triggered')
  assert.equal(f.steered.length, 2)
})

test('automatic checkpoint rejects unsafe trigger configuration', () => {
  assert.throws(() => new AutoCheckpointCoordinator({ pressureThreshold: 0.99 }), /pressureThreshold/)
  assert.throws(() => new AutoCheckpointCoordinator({ cooldownTurns: 0 }), /cooldownTurns/)
  const f = autoFixture()
  const controller = new AbortController()
  controller.abort()
  assert.equal(new AutoCheckpointCoordinator().evaluateAndTrigger({ agent: f.agent, turn: 1,
    signal: controller.signal }), 'cancelled')
})
