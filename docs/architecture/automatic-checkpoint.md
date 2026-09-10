# Automatic checkpoint M2

Status: **DSH context-pressure trigger implemented behind opt-in configuration; real-host acceptance open**.
Scope: [#56](https://github.com/IHongTaoI/maestro-workflow/issues/56). Updated 2026-09-10.

## Capability matrix

| Host | Capability available | Feature activated |
| --- | --- | --- |
| DSH `0.1.1-rc.2` declarations | `agent/turn-stopping` is awaited; request route can expose `contextWindow`; assistant events can expose token usage | Opt-in pressure trigger is implemented. It is not called pre-compaction or Session End. |
| Codex Hooks | Official Hooks documentation exposes real `PreCompact`, `PostCompact`, `SessionEnd`, `Stop` and `SessionStart` events | Existing plugin activates only `SessionStart`. Automatic checkpoint is unsupported until a bounded model/tool path can supply target and facts before compaction. |
| Bare Core Skill | No deterministic lifecycle capability | Unsupported; explicit save remains available through host tools. |

Capability availability and feature activation are recorded separately. A hook name or declaration scan is not live
acceptance evidence.

## DSH trigger flow

The Adapter reads only typed DSH Session events. It does not estimate tokens from text or copy the transcript.

1. At the real awaited `agent/turn-stopping` event, read the latest advertised context window and assistant usage.
2. Continue normally when pressure is unknown or below the configured threshold.
3. Compare the append-only Session log with the latest committed checkpoint and latest automatic reminder.
4. Require new user input or a non-checkpoint tool result, then apply turn cooldown and cancellation checks.
5. Steer one bounded plugin instruction into the current turn. The current Agent decides whether a relevant active
   Temporary/Task exists and reuses `maestro_checkpoint inspect/save/status/retry`.
6. Observe a committed/already-committed tool result from the durable Session log for future deduplication.

The default `0.72` threshold is only an experimental starting point. Operators can configure `0.5–0.95`, cooldown
turns and hook timeout. The Adapter does not claim one universal safe percentage.

## Failure and safety

- The hook wait is bounded and receives a combined cancellation/deadline signal. Timeout or failure is logged and
  cannot indefinitely block turn close.
- One reminder is durably identifiable in the Session log. An ignored reminder cannot loop in the same turn.
- A failed save stays visible through the native tool result and M1's immutable request/failure records. It is never
  re-labelled as success.
- The reminder cannot create a Task, select an unrelated old target, expand paths or permissions, or restore old
  authorization.
- Missing agents/fs/tools, context capacity, usage, or schema causes explicit fallback. The plain Skill remains usable.

## Why Codex is not wired yet

Codex now has a real `PreCompact` event and waits for synchronous command hooks. However, its documented event input
provides the Session/transcript location and trigger—not a stable structured Maestro target plus current bounded facts.
`PreCompact` can stop compaction, but it cannot by itself ask the current model to prepare and commit the M1 snapshot.
The transcript format is explicitly not a stable hook interface. Therefore the current Codex plugin records the
capability as available but leaves automatic checkpoint inactive instead of guessing or silently copying a transcript.

Reference: [official Codex Hooks documentation](https://learn.chatgpt.com/docs/hooks).
