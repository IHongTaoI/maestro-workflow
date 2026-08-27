# Maestro Reliability Contracts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden Maestro's mutable state, Handoffs, Task promotion, authorization, and durable-memory behavior for issue #6.

**Architecture:** Keep Maestro host-independent by expressing reliability as Markdown contracts, small JSON Schemas for parsed YAML/JSON records, and behavioral scenario fixtures. Prevent stale writes with an exclusive per-state lock plus an in-lock revision comparison and atomic replacement; do not add a Runtime or mandatory role sequence.

**Tech Stack:** Markdown Skill references, JSON Schema draft 2020-12, Ajv schema verification.

---

### Task 1: Define metadata and concurrent-write contracts

**Files:**
- Modify: `maestro/references/storage.md`
- Create: `maestro/references/schemas/temporary-meta.schema.json`
- Create: `maestro/references/schemas/task.schema.json`

1. Add the per-state exclusive-lock and revision protocol, including contention, mismatch,
   reconciliation, abandoned-lock, and unsupported-host behavior.
2. Add `revision` and `updated_by` to Temporary metadata and define minimal Task metadata.
3. Define which files are mutable logical state and how multi-file transitions are published.
4. Parse representative YAML-shaped objects and validate them against both schemas.

### Task 2: Complete the Handoff user-input contract

**Files:**
- Modify: `maestro/references/handoffs.md`
- Modify: `maestro/references/schemas/handoff.schema.json`

1. Add structured `questions` with required `question` and `reason` fields.
2. Require at least one question when `needs_user_input` is true and prohibit non-empty questions
   when it is false.
3. Validate one accepted and two rejected Handoff examples.

### Task 3: Define promotion and authorization decisions

**Files:**
- Modify: `maestro/SKILL.md`
- Modify: `maestro/references/coordination.md`

1. Separate exploration, evidence collection, and reversible experiments from formal execution.
2. Define an ordered, recoverable Temporary-to-Task promotion transaction.
3. Add a concise authorization matrix and state that role recommendations cannot grant authority.
4. Cross-check direct-role behavior remains available without a fixed workflow.

### Task 4: Define Long-term Memory supersession

**Files:**
- Modify: `maestro/references/memory.md`

1. Add evidence precedence.
2. Define sourced approval, rejection, and supersession records.
3. Preserve stale entries for audit while preventing them from being presented as current truth.

### Task 5: Add behavioral regression scenarios

**Files:**
- Create: `maestro/references/scenarios/reliability.md`

1. Add fixtures for read-only performance investigation, Temporary resume, Task promotion, direct
   role invocation, Session Handoff, dangerous action authorization, stale revision conflict, and
   Long-term supersession.
2. Include explicit `EXPECT` and `MUST NOT` clauses for each case.
3. Run schema parsing, contract-presence checks, JSON formatting checks, and `git diff --check`.

### Task 6: Review and commit

**Files:**
- Review all files changed above.

1. Inspect staged and unstaged diffs for scope and consistency.
2. Stage only the issue #6 files.
3. Commit with a focused documentation/schema message.
