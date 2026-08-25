# DeepSeek Harness Capability Baseline

## Compatibility target

Maestro v3 currently targets `@deepseek-ai/dsh` `0.1.1-rc.2`. The version is pinned as a compatibility target, not an assertion that every DSH composition exposes every optional tool.

## Verified design contracts

- DSH `workflow` accepts plain data `{ script, meta, args }`; it owns the live run, child-session lifecycle, cancellation and cleanup.
- The script receives `agent`, `parallel`, `pipeline`, `phase`, `log`, and `args`. `phase` is progress vocabulary, not dependency scheduling.
- `todo_write` is session-owned runtime progress. It is distinct from the static Maestro Task Graph.
- `create_goal` persists a same-session goal and is root-authorized. It is not Maestro's durable project memory.

Maestro therefore validates graph dependencies before compilation and emits a fixed script template. YAML descriptions and other user content are carried as JSON `args`, never inserted into executable source.

## Required manual verification

The automated suite does not invoke a model or start DSH. Before claiming a live integration, manually verify in the selected DSH version:

1. The `maestro-workflow` Skill is discoverable in the intended installation scope.
2. The current session can run `workflow` with the compiled request.
3. A TPM child Agent returns a schema-valid result and the parent receives the completed workflow result.
4. `todo_write` renders runtime progress without changing Task Graph semantics.
5. Cancellation and an interrupted child leave a truthful DSH workflow result.

Run `npm run dsh:probe` for a read-only local CLI diagnostic. `unavailable` means only that `dsh` is not on `PATH`; it is not a failing test and does not modify DSH.
