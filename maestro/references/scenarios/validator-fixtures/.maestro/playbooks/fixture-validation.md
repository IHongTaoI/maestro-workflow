---
playbook_id: pb-fixture-validation
file_path: .maestro/playbooks/fixture-validation.md
title: Validate protocol artifacts
trigger: A formal Maestro protocol artifact is about to be persisted.
steps:
  - Run the matching artifact-triggered protocol guard.
  - Persist the canonical artifact only after validation succeeds.
checks:
  - The protocol guard exits successfully.
status: active
revision: 2
updated_at: 2026-08-29T00:00:00Z
updated_by: old-zhou/fixture
source_refs:
  - files/source.md
---

# Validate protocol artifacts

Run the matching guard before persistence.
