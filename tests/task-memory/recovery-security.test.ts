import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadRoleState } from "../../src/memory/three-layer-store.ts";
import { roleStatePath } from "../../src/task-memory/paths.ts";
import { recordTaskRun, TaskRunRecordError } from "../../src/task-memory/record-run.ts";
import { prepareTaskRun, recoverTaskRunState } from "../../src/task-memory/task-run.ts";
import { createTask, persistTask } from "../../src/task-memory/task-store.ts";
import { parseTaskGraph } from "../../src/task-graph/parse.ts";
import { validateTaskGraph } from "../../src/task-graph/validate.ts";

function graph() {
  return validateTaskGraph(parseTaskGraph(`
name: recovery-security
tasks:
  - id: requirements
    role: tpm
    description: Confirm requirements.
`));
}

function result(artifacts: Array<{ path: string; description: string }> = []) {
  return {
    graph: "recovery-security",
    tasks: {
      requirements: {
        summary: "Requirements captured.",
        artifacts,
        blockers: [],
        roleState: {
          summary: "Scope confirmed.",
          decisions: ["Use project-local state."],
          blockers: [],
          nextActions: ["Implement."],
        },
      },
    },
  };
}

test("replays role state when recovering a recorded result after a crash", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "maestro-role-recovery-"));
  try {
    await createTask({ projectRoot, taskId: "health", graph: graph() });
    await prepareTaskRun({ projectRoot, taskId: "health" });
    const recorded = await recordTaskRun({ projectRoot, taskId: "health", result: result() });
    await rm(roleStatePath(projectRoot, "health", "tpm"), { force: true });
    await persistTask(projectRoot, { ...recorded.task, status: "running", activeRunId: recorded.run.id });

    const recovered = await recoverTaskRunState({ projectRoot, taskId: "health" });
    assert.equal(recovered.recovered, "recorded-result");
    assert.equal((await loadRoleState(projectRoot, "health", "tpm"))?.sourceRunId, recorded.run.id);
    assert.equal((await loadRoleState(projectRoot, "health", "tpm"))?.summary, "Scope confirmed.");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("rejects artifact files reached through an out-of-project symlink ancestor", async (t) => {
  if (process.platform === "win32") {
    t.skip("directory symlink creation is not portable on Windows CI");
    return;
  }
  const projectRoot = await mkdtemp(join(tmpdir(), "maestro-artifact-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "maestro-artifact-outside-"));
  try {
    await createTask({ projectRoot, taskId: "health", graph: graph() });
    await prepareTaskRun({ projectRoot, taskId: "health" });
    await writeFile(join(outside, "spec.md"), "outside\n");
    await symlink(outside, join(projectRoot, "requirements"), "dir");

    await assert.rejects(
      recordTaskRun({ projectRoot, taskId: "health", result: result([{ path: "requirements/spec.md", description: "Should be rejected." }]) }),
      (error: unknown) => error instanceof TaskRunRecordError && /symlink/.test(error.message),
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
