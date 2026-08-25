# DeepSeek Harness MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a clean Maestro v3 foundation that validates and compiles a static Task Graph into a DeepSeek Harness workflow request without implementing an Agent runtime or DAG scheduler.

**Architecture:** Maestro owns task-graph semantics, role contracts, generated workflow source, and durable project artifacts. DeepSeek Harness owns child-agent execution, workflow lifecycle, goals, and session-owned `todo_write` progress. The compiler produces data `{ script, meta, args }` accepted by DSH's `workflow` tool; its generated script uses only DSH workflow hooks and never reimplements scheduling.

**Tech Stack:** Node.js 22+, TypeScript ESM, `node:test`, `yaml`, `tsx`, and TypeScript.

---

## Scope and acceptance criteria

- A constrained YAML Task Graph with `id`, `role`, `description`, `depends_on`, and optional `acceptance` is parsed and validated.
- Invalid identifiers, unknown roles, duplicate IDs, missing dependencies, and cyclic graphs fail before compilation.
- The compiler emits one deterministic DSH workflow request. Its `meta.phases` is display/progress vocabulary only; dependencies are represented exclusively in the generated script.
- Independent ready tasks are dispatched through DSH `parallel()` and dependent tasks await their prerequisites. Compilation is deliberately limited to the DSH documented workflow hooks.
- The DSH probe reports local CLI presence/version without starting a Web UI, contacting a model, or changing user configuration.
- Lao Zhou and the five MVP role prompts exist as static assets. They instruct roles to return structured artifacts, while DSH `todo_write` remains session progress rather than a Maestro task graph.

## Task 1: Establish the v3 Node workspace

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `README.md`

1. Declare ESM, Node `>=22.18`, scripts for typecheck, tests, and the DSH probe.
2. Add only the concrete dependencies needed for YAML parsing and TypeScript test execution.
3. Document the v3 boundary: Maestro compiles workflow requests; DSH executes them.
4. Run `npm install`, `npm run typecheck`, and `npm test` after the first source/test is present.
5. Commit: `chore: bootstrap maestro v3 workspace`.

## Task 2: Define and validate the Task Graph

**Files:**

- Create: `src/task-graph/types.ts`
- Create: `src/task-graph/parse.ts`
- Create: `src/task-graph/validate.ts`
- Test: `tests/task-graph/parse.test.ts`
- Test: `tests/task-graph/validate.test.ts`

1. Write tests for one valid sequential graph and each invalid condition in the scope list.
2. Define the five accepted MVP roles: `tpm`, `architect`, `planner`, `coder`, `tester`.
3. Parse YAML into data only; never execute content from the graph.
4. Validate IDs, role membership, dependency references, self-dependencies, duplicate dependency edges, and cycles.
5. Run the focused tests, then commit: `feat: validate task graphs`.

## Task 3: Compile graph data to a DSH workflow request

**Files:**

- Create: `src/dsh/workflow-contract.ts`
- Create: `src/dsh/compile-workflow.ts`
- Test: `tests/dsh/compile-workflow.test.ts`

1. Write a deterministic expected-output test for an independent pair followed by a dependent tester task.
2. Model only the documented DSH tool input `{ script, meta, args }`; do not instantiate an engine, parent Agent, or transport.
3. Generate a plain-JavaScript script body that calls `phase()`, `agent()`, and `parallel()` safely; return JSON-safe task results.
4. Assert that prompts and graph data are JSON encoded, preventing source injection from YAML strings.
5. Run the compiler tests and commit: `feat: compile task graph for dsh workflow`.

## Task 4: Add roles and Lao Zhou as static DSH assets

**Files:**

- Create: `skills/maestro-workflow/SKILL.md`
- Create: `skills/maestro-workflow/roles/tpm.md`
- Create: `skills/maestro-workflow/roles/architect.md`
- Create: `skills/maestro-workflow/roles/planner.md`
- Create: `skills/maestro-workflow/roles/coder.md`
- Create: `skills/maestro-workflow/roles/tester.md`
- Test: `tests/assets/roles.test.ts`

1. Write an asset test for frontmatter and the required role files.
2. Keep each role's output path and non-responsibilities explicit.
3. Make Lao Zhou request an explicit user start before invoking DSH `workflow`.
4. State that `todo_write` tracks only the current DSH session's runtime checklist.
5. Run asset tests and commit: `feat: add dsh workflow role assets`.

## Task 5: Implement the non-invasive DSH probe

**Files:**

- Create: `src/dsh/probe.ts`
- Test: `tests/dsh/probe.test.ts`
- Create: `docs/dsh-capability-baseline.md`

1. Write tests with an injected command runner for unavailable, valid, and malformed version output.
2. Implement a read-only probe for `dsh --version`; do not use `npx`, launch `dsh web`, or mutate DSH configuration.
3. Document the verified compatibility target, required DSH tools, known unverified behavior, and a manual evidence checklist.
4. Run the probe locally; an unavailable binary is a valid diagnostic, not a failed test.
5. Commit: `feat: add dsh compatibility probe`.

## Task 6: Verify the MVP and document the handoff

**Files:**

- Modify: `README.md`
- Modify: `docs/dsh-capability-baseline.md`

1. Run `npm run typecheck` and `npm test`.
2. Run `npm run dsh:probe` and record the factual local result without upgrading compatibility claims.
3. Update README with the supported development commands and deliberately deferred features: multi-coder concurrency policy, revisions, automatic Wiki promotion, Cordis dashboard, and DSH installation automation.
4. Commit: `docs: record dsh mvp verification`.
