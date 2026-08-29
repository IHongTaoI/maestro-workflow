import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerLifecycleHooks } from './hooks'
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
