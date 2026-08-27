# Capability-based Workers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add host-independent capability routing that reuses, composes, or creates bounded Task-scoped Workers without replacing stable roles.

**Architecture:** Express Worker selection as Skill contracts, immutable snapshots, small JSON Schemas, and behavioral fixtures. Reuse the existing revision, lock, transaction, Handoff, and authorization protocols rather than introducing an executable Runtime.

**Tech Stack:** Markdown contracts, JSON Schema Draft 2020-12, JSON fixtures, PowerShell verification, Ajv CI.

---

### Task 1: Define Worker and resolver contracts

**Files:**
- Create: `maestro/references/workers.md`
- Modify: `maestro/SKILL.md`
- Modify: `maestro/references/coordination.md`
- Modify: `maestro/references/storage.md`

1. Define canonical capability requirements and stable-role versus Worker boundaries.
2. Define deterministic exact, compatible, composed, and generated resolution.
3. Define registry mutation, immutable Task snapshots, recovery, and failure behavior.
4. State that Worker permission declarations never grant authority.

### Task 2: Make built-in roles capability-addressable

**Files:**
- Create: `maestro/references/workers/builtin-registry.json`
- Modify: `maestro/references/roles/*.md`

1. Add a minimal canonical capability list to every existing role.
2. Add matching Worker entries to the immutable built-in registry.
3. Verify IDs and capabilities are unique and canonical.

### Task 3: Add machine-checkable contracts

**Files:**
- Create: `maestro/references/schemas/capability-requirements.schema.json`
- Create: `maestro/references/schemas/worker.schema.json`
- Create: `maestro/references/schemas/worker-registry.schema.json`
- Create: `maestro/references/schemas/worker-selection.schema.json`
- Modify: `maestro/references/schemas/handoff.schema.json`
- Modify: `maestro/references/handoffs.md`

1. Validate capability IDs, Worker scope, context, tools, requested actions, and lifecycle.
2. Validate resolver outcomes and immutable snapshot paths.
3. Support either role or Worker state in Handoffs without breaking existing fixtures.
4. Allow next-step recommendations by role or capability requirements.

### Task 4: Add regression scenarios and CI coverage

**Files:**
- Create: `maestro/references/scenarios/capability-workers.md`
- Create: `maestro/references/scenarios/schema-fixtures/*worker*.json`
- Modify: `scripts/verify-contracts.ps1`
- Modify: `README.md`

1. Add valid fixtures for built-in reuse, composition, and generated Task-scoped Workers.
2. Add invalid fixtures for lifecycle, Handoff ambiguity, and permission-boundary violations.
3. Add custom checks for duplicate IDs and canonical capability identifiers.
4. Run the verifier standalone, check Markdown links/fences, and run `git diff --check`.

### Task 5: Publish for review

1. Inspect staged and unstaged changes and commit only #7 files.
2. Push `codex/issue-7-capability-workers`.
3. Open a Draft PR targeting `master` with `Closes #7` and verification evidence.

