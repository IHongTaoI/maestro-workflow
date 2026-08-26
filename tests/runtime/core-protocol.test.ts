import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyPermissions, collectResult, commitMemory, submitProposal, validateProposal } from "../../src/runtime/core-protocol.ts";
import { queryProjectMemory } from "../../src/task-memory/memory-store.ts";
import { createWorkspace } from "../../src/workspace/store.ts";

test("guards role effects through the five Core actions", async () => {
  const root = await mkdtemp(join(tmpdir(), "maestro-core-"));
  try {
    await createWorkspace({ projectRoot: root, workspaceId: "core-probe", identity: "Core protocol", mode: "lite", request: "Implement output." });
    await assert.rejects(applyPermissions({ projectRoot: root, workspaceId: "core-probe", role: "coder", write: [".agents/.local/work/core-probe/meta.json"] }), /protected path/);
    const grant = await applyPermissions({ projectRoot: root, workspaceId: "core-probe", role: "coder", read: ["src"], write: ["src"], id: "permission-coder" });
    const proposal = await submitProposal({ projectRoot: root, workspaceId: "core-probe", taskId: "implement", role: "coder", summary: "Write output.", effects: [{ action: "write", path: "src/output.txt" }], expectedOutputs: ["src/output.txt"], id: "proposal-implement" });
    assert.equal((await validateProposal({ projectRoot: root, workspaceId: "core-probe", proposalId: proposal.id, permissionGrantId: grant.id })).status, "approved");
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "output.txt"), "done\n");
    const result = await collectResult({ projectRoot: root, workspaceId: "core-probe", proposalId: proposal.id, summary: "Implemented.", artifactPaths: ["src/output.txt"] });
    const memory = await commitMemory({ projectRoot: root, workspaceId: "core-probe", resultId: result.id, memoryId: "memory-core-run-000001", runId: "run-000001", tags: ["core"] });
    assert.equal(memory.role, "coder");
    assert.equal((await queryProjectMemory({ projectRoot: root, queries: ["implemented"], taskId: "implement", role: "coder" })).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
