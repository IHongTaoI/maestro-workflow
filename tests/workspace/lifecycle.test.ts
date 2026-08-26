import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { recordTestReport, writeDeliveryReport } from "../../src/testing/gate.ts";
import { advanceWorkspace, createWorkspace, reviseWorkspace } from "../../src/workspace/store.ts";
import { workspaceRoot } from "../../src/workspace/paths.ts";

test("enforces the full workflow lifecycle, checkpoints and delivery gates", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "maestro-workspace-"));
  try {
    const id = "202608260900-api-health";
    const root = workspaceRoot(projectRoot, id);
    let meta = await createWorkspace({ projectRoot, workspaceId: id, identity: "Add API health endpoint", mode: "workflow", request: "Create a health endpoint." });
    meta = await advanceWorkspace({ projectRoot, workspaceId: id });
    assert.equal(meta.currentStage, "requirements");
    await mkdir(join(root, "requirements"), { recursive: true });
    await writeFile(join(root, "requirements", "spec.md"), "# Spec\n");
    meta = await advanceWorkspace({ projectRoot, workspaceId: id });
    await mkdir(join(root, "design"), { recursive: true });
    await writeFile(join(root, "design", "design.md"), "# Design\n");
    meta = await advanceWorkspace({ projectRoot, workspaceId: id });
    await writeFile(join(root, "design", "architecture.md"), "# Architecture\n");
    await mkdir(join(root, "planning"), { recursive: true });
    await writeFile(join(root, "planning", "task-graph.yaml"), "name: health\ntasks: []\n");
    meta = await advanceWorkspace({ projectRoot, workspaceId: id });
    await writeFile(join(root, "planning", "task-plan.md"), "# Tasks\n");
    await writeFile(join(root, "planning", "automated-test-plan.md"), "# Tests\n");
    meta = await advanceWorkspace({ projectRoot, workspaceId: id });
    await mkdir(join(root, "implementation"), { recursive: true });
    await writeFile(join(root, "implementation", "execution.json"), "{}\n");
    meta = await advanceWorkspace({ projectRoot, workspaceId: id });
    assert.equal(meta.currentStage, "testing");
    await assert.rejects(advanceWorkspace({ projectRoot, workspaceId: id }), /missing/);
    await recordTestReport({ projectRoot, workspaceId: id, checks: [{ kind: "unit", required: true, status: "passed", summary: "All unit tests passed." }] });
    meta = await advanceWorkspace({ projectRoot, workspaceId: id });
    await writeDeliveryReport({ projectRoot, workspaceId: id, summary: "Ready.", accepted: true });
    meta = await advanceWorkspace({ projectRoot, workspaceId: id });
    assert.equal(meta.status, "completed");

    const revised = await reviseWorkspace({ projectRoot, workspaceId: id, severity: "critical", reason: "Requirement changed." });
    assert.equal(revised.currentStage, "requirements");
    assert.equal(revised.status, "active");
    assert.equal(revised.stageRevisions.requirements, 2);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
