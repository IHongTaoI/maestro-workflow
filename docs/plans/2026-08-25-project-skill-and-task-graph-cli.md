# Project Skill and Task Graph CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the v3 DSH Skill installable per project and expose a safe CLI that compiles a YAML Task Graph into the exact request consumed by DSH's `workflow` tool.

**Architecture:** `src/dsh/install-skill.ts` owns deterministic copying and conflict detection for `<project>/.dsh/skills/maestro-workflow`. `src/cli.ts` is a local translation boundary: it reads and validates Task Graph YAML, prints the compiler's JSON request, and never launches DSH or executes a model. The installed Skill tells the foreground DSH session to use that compiled request, preserving DSH as the execution owner.

**Tech Stack:** Node.js 22+, TypeScript ESM, `node:fs/promises`, `node:test`, `tsx`, and the existing `yaml` dependency.

---

### Task 1: Test and implement project Skill installation

**Files:**

- Create: `src/dsh/install-skill.ts`
- Test: `tests/dsh/install-skill.test.ts`

1. Write failing temporary-directory tests for a fresh install, byte-identical idempotent install, modified-target conflict, and explicit `force` replacement.
2. Copy only `skills/maestro-workflow/` into `<project>/.dsh/skills/maestro-workflow/`.
3. Compare complete relative file trees and bytes before treating a target as unchanged.
4. Refuse a modified existing target unless `force` is explicitly passed; restrict any replacement to the fixed Skill target path.
5. Run focused tests and commit: `feat: install project dsh skill`.

### Task 2: Test and implement the local CLI

**Files:**

- Create: `src/cli.ts`
- Test: `tests/cli.test.ts`
- Modify: `package.json`

1. Write failing tests for command parsing and exact JSON compilation output.
2. Add `compile-task-graph`, `install-dsh-skill`, and `verify-dsh-skill` commands.
3. Make `compile-task-graph --file <path>` parse, validate, compile, and print only the DSH request JSON.
4. Make installation and verification commands report structured JSON without opening DSH or sending a model request.
5. Add npm script aliases and run focused tests and typecheck.

### Task 3: Add a smoke graph and update the installed Skill guidance

**Files:**

- Create: `examples/tpm-smoke.task-graph.yaml`
- Modify: `skills/maestro-workflow/SKILL.md`
- Modify: `tests/assets/roles.test.ts`

1. Add a one-task TPM graph that matches the already verified Harness smoke scope.
2. Add an asset test that requires the Skill to reference the local compile command and explicit user start.
3. Instruct Lao Zhou to compile only through `npm run maestro -- compile-task-graph`, then pass that JSON unchanged to DSH `workflow`.
4. Run asset tests and commit: `feat: guide dsh task graph execution`.

### Task 4: Verify and document the project workflow entry

**Files:**

- Modify: `README.md`
- Modify: `docs/dsh-capability-baseline.md`

1. Document installation, verification, compilation, and the manual DSH Web handoff.
2. Run `npm run typecheck`, `npm test`, `npm run dsh:probe`, a fresh temporary project install test, and CLI compilation of the sample graph.
3. Record only the verified installation/compilation boundary; do not claim a live automatic workflow invocation.
4. Commit: `docs: add dsh project workflow entry`.
