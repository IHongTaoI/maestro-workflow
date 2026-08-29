# Playbook Candidates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let Maestro extract evidence-backed reusable procedures as review-only Playbook Candidate proposals for Issue #15.

**Architecture:** Extend the existing Memory Worker request with a current Playbook index and its response with `playbook_candidates`. JSON Schema and the Python protocol validator enforce identical proposal rules; documentation preserves explicit user approval and guidance-only Playbooks.

**Tech Stack:** Markdown contracts, JSON Schema Draft 2020-12, Python 3 standard library, PowerShell contract runner, Ajv CLI.

---

### Task 1: Add failing Playbook Candidate fixtures

**Files:**
- Modify: `maestro/references/scenarios/validator-fixtures/memory-request-valid.json`
- Modify: `maestro/references/scenarios/validator-fixtures/memory-response-valid.json`
- Create: `maestro/references/scenarios/validator-fixtures/memory-response-playbook-action-invalid.json`
- Create: `maestro/references/scenarios/validator-fixtures/memory-response-playbook-status-invalid.json`
- Create: `maestro/references/scenarios/validator-fixtures/memory-response-playbook-duplicate-id-invalid.json`
- Modify: `scripts/verify-contracts.ps1`

**Steps:**
1. Add an indexed current Playbook to the valid request fixture.
2. Add reusable CREATE, UPDATE, and low-value SKIP candidates to the valid response fixture.
3. Add invalid action-cardinality, non-candidate status, and duplicate-ID fixtures.
4. Register schema-parity and semantic diagnostic cases.
5. Run `npm run test:contracts`; expect new valid fixtures to fail before implementation.

### Task 2: Implement request and response schemas

**Files:**
- Modify: `maestro/references/schemas/memory-worker-request.schema.json`
- Modify: `maestro/references/schemas/memory-worker-response.schema.json`

**Steps:**
1. Require `current_playbooks` and define indexed Playbook fields.
2. Define Playbook Candidate trigger, steps, checks, match, source, evidence, and status fields.
3. Encode CREATE, UPDATE, MERGE, and SKIP match cardinality.
4. Run the focused Ajv fixtures; expect schema-valid cases to pass and invalid cases to fail.

### Task 3: Mirror validation in the protocol guard

**Files:**
- Modify: `maestro/scripts/validate.py`

**Steps:**
1. Validate current Playbook shape, stable IDs, and reachable references.
2. Validate Playbook Candidate shape, action/match rules, and candidate-only status.
3. Reject duplicate indexed Playbook and candidate IDs.
4. Validate `evidence_refs` as reachable project-relative files.
5. Run focused Python validator cases, then the contract suite.

### Task 4: Document workflow evolution

**Files:**
- Modify: `maestro/references/memory.md`
- Modify: `maestro/references/playbooks.md`
- Modify: `maestro/SKILL.md`
- Modify: `scripts/verify-contracts.ps1`

**Steps:**
1. Define the declarative Memory versus procedural Playbook boundary.
2. Document extraction, comparison, UPDATE/MERGE/CREATE/SKIP ordering, persistence, and review.
3. Require explicit user approval and forbid automatic promotion or permission expansion.
4. Preserve dynamic Role selection and host independence.
5. Add contract-string assertions and run the full contract suite.

### Task 5: Verify and publish

**Files:**
- Review: all changed files

**Steps:**
1. Run `npm verify`.
2. Run `git diff --check` and inspect the complete diff.
3. Commit only Issue #15 files on `codex/issue-15-playbook-candidates`.
4. Push the branch and create a Draft PR targeting `master`.
5. State `Implemented by Codex` and `Closes #15` in the PR body.
6. Verify the PR metadata and initial checks.
