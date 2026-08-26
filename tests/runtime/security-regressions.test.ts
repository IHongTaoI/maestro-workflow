import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyPermissions, collectResult, submitProposal, validateProposal } from "../../src/runtime/core-protocol.ts";
import { TaskLockConflictError, withTaskLock } from "../../src/runtime/task-lock.ts";
import { createWorkspace } from "../../src/workspace/store.ts";

test("rejects backslash absolute-path aliases before permission checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "maestro-path-regression-"));
  try {
    await createWorkspace({ projectRoot: root, workspaceId: "path-probe", identity: "Path probe", mode: "lite", request: "Probe paths." });
    await assert.rejects(
      applyPermissions({ projectRoot: root, workspaceId: "path-probe", role: "coder", write: ["\\"] }),
      /project-relative/,
    );
    await assert.rejects(
      applyPermissions({ projectRoot: root, workspaceId: "path-probe", role: "coder", write: ["\\tmp\\outside"] }),
      /project-relative/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("re-checks symlink containment when collecting an approved result", async (t) => {
  if (process.platform === "win32") {
    t.skip("directory symlink creation is not portable on Windows CI");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "maestro-core-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "maestro-core-outside-"));
  try {
    await createWorkspace({ projectRoot: root, workspaceId: "symlink-probe", identity: "Symlink probe", mode: "lite", request: "Probe containment." });
    await mkdir(join(root, "src"));
    const grant = await applyPermissions({ projectRoot: root, workspaceId: "symlink-probe", role: "coder", write: ["src"], id: "permission-coder" });
    const proposal = await submitProposal({
      projectRoot: root,
      workspaceId: "symlink-probe",
      taskId: "implement",
      role: "coder",
      summary: "Write output.",
      effects: [{ action: "write", path: "src/output.txt" }],
      expectedOutputs: ["src/output.txt"],
      id: "proposal-implement",
    });
    assert.equal((await validateProposal({ projectRoot: root, workspaceId: "symlink-probe", proposalId: proposal.id, permissionGrantId: grant.id })).status, "approved");

    await rm(join(root, "src"), { recursive: true, force: true });
    await writeFile(join(outside, "output.txt"), "outside\n");
    await symlink(outside, join(root, "src"), "dir");
    await assert.rejects(
      collectResult({ projectRoot: root, workspaceId: "symlink-probe", proposalId: proposal.id, summary: "Done.", artifactPaths: ["src/output.txt"] }),
      /symlink/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("serializes stale-lock reclamation before exposing the task lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "maestro-lock-regression-"));
  try {
    const lock = join(root, "locks", "task.lock");
    await mkdir(join(root, "locks"), { recursive: true });
    await writeFile(lock, `${JSON.stringify({ pid: 2_147_483_647, createdAt: "2026-08-26T00:00:00.000Z" })}\n`);

    let enteredResolve!: () => void;
    let releaseResolve!: () => void;
    const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
    const release = new Promise<void>((resolve) => { releaseResolve = resolve; });
    const first = withTaskLock(lock, async () => {
      enteredResolve();
      await release;
    });
    await entered;
    await assert.rejects(withTaskLock(lock, async () => undefined), TaskLockConflictError);
    releaseResolve();
    await first;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
