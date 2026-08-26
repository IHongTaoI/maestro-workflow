# Maestro v1 Phase Two Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add reviewed long-term memory, Task completion/archive, optional Playbook reads, and host-neutral model adapters.

**Architecture:** Extend the existing Runtime with independent lifecycle operations and keep orchestration in the Maestro Skill. Persist reviewable artifacts before promotion and use adapter functions rather than vendor SDKs.

**Tech Stack:** Node.js 20+, ES modules, built-in `node:test`, JSON/Markdown filesystem artifacts.

---

### Task 1: Long-term memory candidate lifecycle

**Files:**
- Modify: `src/memory-contract.js`
- Modify: `src/runtime.js`
- Modify: `src/store.js`
- Test: `test/runtime.test.js`

1. Add failing tests for candidate persistence, explicit approval, rejection receipts, and source refs.
2. Run `node --test test/runtime.test.js` and confirm failure.
3. Normalize candidate fields and persist candidates returned by Memory Worker runs.
4. Add list/review/promote Runtime operations with an explicit approval requirement.
5. Run the focused tests and confirm success.

### Task 2: Task completion and archive

**Files:**
- Modify: `src/memory-contract.js`
- Modify: `src/runtime.js`
- Modify: `src/store.js`
- Test: `test/runtime.test.js`

1. Add failing tests for successful completion and Memory Worker pending fallback.
2. Add the `task-complete` Memory Worker operation.
3. Write completion artifacts, persist candidates, update status, and move active Tasks to archive.
4. Run focused tests and confirm success.

### Task 3: Optional Playbook reads

**Files:**
- Modify: `src/runtime.js`
- Modify: `src/store.js`
- Test: `test/playbooks.test.js`

1. Add failing tests for JSON/Markdown discovery, reads, and path rejection.
2. Add contained file listing and text reads to the Store.
3. Implement Runtime Playbook list/read operations without workflow interpretation.
4. Run focused tests and confirm success.

### Task 4: Host model adapter

**Files:**
- Create: `src/model-adapter.js`
- Modify: `src/index.js`
- Test: `test/model-adapter.test.js`

1. Add failing tests for direct objects, common text response shapes, fenced JSON, and malformed output.
2. Implement `createModelRunner` and response extraction.
3. Run focused tests and confirm success.

### Task 5: CLI, schemas, documentation, and verification

**Files:**
- Modify: `src/cli.js`
- Modify: `schemas/memory-worker-request.schema.json`
- Modify: `schemas/memory-worker-response.schema.json`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `README.md`
- Test: `test/cli.test.js`

1. Add CLI commands for Task completion, memory review, and Playbook reads.
2. Update schemas and user documentation.
3. Make syntax checks portable across shells and preserve all required ignore rules.
4. Run `npm test` and `npm run check`; both must pass.
5. Inspect `git diff --check` and repository status before delivery.
