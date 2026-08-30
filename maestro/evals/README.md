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
npm run test:evals
```

The replay data is a deterministic runner regression baseline. It is not evidence that a live model
still follows the Skill. For a real behavior run, supply an execution adapter:

```text
node maestro/evals/run.mjs --adapter ./path/to/host-adapter.mjs
```

The module exports `async function runCase(request)`. `request.case` is the case definition and
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
into a Maestro workflow Runtime. CI validates all case/observation schemas and replays the fixed
baseline; live model runs can be scheduled by a host integration without making ordinary pull
requests depend on credentials, cost, or sampling variance.
