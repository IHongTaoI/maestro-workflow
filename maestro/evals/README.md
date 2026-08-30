# Maestro behavior evals

These fixtures test the decisions made from `SKILL.md` and its references. Contract tests validate
schemas and persisted records; evals check whether an Agent chooses the expected work shape,
Worker, memory route, Handoff, and authorization boundary.

## Case contract

Every JSON file under `cases/` conforms to `case.schema.json` and contains:

- `setup`: the state visible before the conversation, including active Temporaries when needed;
- `turns`: one or more user prompts, so resumption and promotion can be tested without flattening
  them into an artificial single prompt;
- `expect`: deterministic assertions that must match the normalized observation;
- `must_not`: deterministic assertions whose match fails the case;
- optional `llm_judges`: semantic rubrics used only when a direct observation is insufficient.

Assertion paths are JSON Pointers. Supported operators are `equals`, `contains`, `length_equals`,
`length_lte`, and `exists`. `must_not` negates the complete assertion rather than defining a second
operator vocabulary.

## Run

Replay the checked-in observations to validate the fixture set and assertion runner:

```text
npm run test:evals:fixtures
```

The replay data is a deterministic runner regression baseline. It is not evidence that a live model
still follows the Skill.

## Codex live eval

The included reference adapter installs the current Skill bundle into an isolated temporary
workspace, invokes `codex exec` with a read-only sandbox and ephemeral Session, and constrains its
final response with a structured-output-compatible projection of `observation.schema.json`. The
runner then validates that response against the complete, unmodified schema, including constraints
such as `uniqueItems` that Codex structured output does not accept. The case prompt excludes
`expect`, `must_not`, and judge rubrics, so the Agent cannot copy the desired result from the
fixture. Codex CLI must already be installed and authenticated; live runs consume model usage.

```text
npm run test:evals:live:codex
```

Run one case while iterating on instructions:

```text
npm run test:evals:live:codex -- --case performance-investigation-stays-temporary
```

Set `MAESTRO_CODEX_COMMAND` when the executable is not named `codex`, and
`MAESTRO_CODEX_TIMEOUT_MS` to change the five-minute per-call timeout.

## Adapter contract

Custom hosts can use the same runner:

```text
node maestro/evals/run.mjs --adapter ./path/to/host-adapter.mjs
```

An adapter exports `async function runCase(request)`. `request.case` is the case definition and
`request.skill.files` contains the current `SKILL.md` and references, so rerunning after an
instruction edit tests the edited Core. Return one observation matching `observation.schema.json`.
Adapters own host/model invocation and trace normalization; they must not change the eval cases.

For cases with `llm_judges`, either return `judgments` from the execution adapter or pass a separate
module exporting `async function judgeCase(request)`:

```text
node maestro/evals/run.mjs \
  --adapter ./path/to/host-adapter.mjs \
  --judge-adapter ./path/to/judge-adapter.mjs \
  --json
```

Keeping adapters outside the Core preserves host independence and avoids turning the eval harness
into a Maestro workflow Runtime. CI labels and runs only the fixed fixture replay; the explicit live
command validates current Skill behavior without making ordinary pull requests depend on
credentials, cost, or sampling variance.
