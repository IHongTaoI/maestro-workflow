# Maestro Skill-first Rebuild Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Node Runtime package with a directly installable, zero-JavaScript Maestro Codex Skill.

**Architecture:** Put all orchestration behavior in `maestro/SKILL.md` and progressively disclosed references. Store live state in the user's project `.maestro/` directory using host filesystem and sub-agent tools.

**Tech Stack:** Codex Skill Markdown, YAML configuration examples, JSON Schema contracts.

---

### Task 1: Remove the incorrect application surface

**Files:** Delete `bin/`, `src/`, `scripts/`, `test/`, `schemas/`, `package.json`, and the thin `skills/maestro/` implementation.

1. Record the Skill-first design and plan.
2. Remove npm, CLI, Runtime, adapter, and JavaScript test files with a forward corrective change.
3. Preserve Git history and the `maestro-v1-rebuild` branch.

### Task 2: Build the installable Skill entrypoint

**Files:** Create `maestro/SKILL.md` and focused files under `maestro/references/`.

1. Write discriminating frontmatter for Maestro, Old Zhou, and direct role invocations.
2. Define dynamic coordination and the Temporary-versus-formal-Task confirmation boundary.
3. Route memory, storage, Handoff, Playbook, and role details to focused references.

### Task 3: Add role and memory contracts

**Files:** Create `maestro/references/roles/*.md`, memory/storage/Handoff references, and JSON schemas.

1. Define each role's responsibility, memory hints, and expected result.
2. Define three-layer memory, Current + References, Memory Worker triggers, fallback behavior, and reviewed long-term promotion.
3. Define project-owned `.maestro/` paths and source-linked receipts.

### Task 4: Make installation obvious

**Files:** Rewrite `README.md`; update `.gitignore`.

1. Document copy/install and natural-language invocation.
2. Provide a short first-use example without CLI commands.
3. Remove Node-specific ignore and package guidance.

### Task 5: Validate and deliver

1. Run the bundled Codex `quick_validate.py` against `maestro/`.
2. Parse every JSON schema and verify every Markdown link target exists.
3. Confirm no `.js`, `package.json`, or npm artifact remains in the tracked package.
4. Commit and push the corrective change to `maestro-v1-rebuild`.
