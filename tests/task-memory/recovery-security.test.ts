import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadRoleState } from "../../src/memory/three-layer-store.ts";
import { roleHistoryPath, roleStatePath } from "../../src/task-memory/paths.ts";
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

function sharedRoleGraph() {
  return validateTaskGraph(parseTaskGraph(`
name: shared-role-recovery
tasks:
  - id: first
    role: coder
    description: First coder step.
  - id: second
    role: coder
    description: Second coder step.
    depends: [first]
`));
}

function sharedRoleResult() {
  return {
    graph: "shared-role-recovery",
    tasks: {
      first: {
        summary: "First step complete.",
        artifacts: [],
        blockers: [],
        roleState: {
          summary: "First coder state.",
          decisions: ["First decision."],
          blockers: [],
          nextActions: ["Run second step."],
        },
      },
      second: {
        summary: "Second step complete.",
        artifacts: [],
        blockers: [],
        roleState: {
          summary: "Final coder state.",
          decisions: ["Final decision."],
          blockers: [],
          nextActions: ["Deliver."],
        },
      },
    },
  };
}

async function historyCount(projectRoot: string, taskId: string, role: string): Promise<number> {
  try {
    const source = await readFile(roleHistoryPath(projectRoot, taskId, role), "utf8");
    return source.split("\n").filter((line) => line.trim() !== "").length;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
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

test("recovery is idempotent when multiple task nodes share one role", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "maestro-shared-role-recovery-"));
  try {
    await createTask({ projectRoot, taskId: "shared", graph: sharedRoleGraph() });
    await prepareTaskRun({ projectRoot, taskId: "shared" });
    const recorded = await recordTaskRun({ projectRoot, taskId: "shared", result: sharedRoleResult() });
    const before = await historyCount(projectRoot, "shared", "coder");
    assert.equal((await loadRoleState(projectRoot, "shared", "coder"))?.summary, "Final coder state.");

    await persistTask(projectRoot, { ...recorded.task, status: "running", activeRunId: recorded.run.id });
    const firstRecovery = await recoverTaskRunState({ projectRoot, taskId: "shared" });
    const afterFirst = await historyCount(projectRoot, "shared", "coder");
    assert.equal(firstRecovery.recovered, "recorded-result");
    assert.equal(afterFirst, before);

    await persistTask(projectRoot, { ...firstRecovery.task, status: "running", activeRunId: recorded.run.id });
    const secondRecovery = await recoverTaskRunState({ projectRoot, taskId: "shared" });
    const afterSecond = await historyCount(projectRoot, "shared", "coder");
    assert.equal(secondRecovery.recovered, "recorded-result");
    assert.equal(afterSecond, before);
    assert.equal((await loadRoleState(projectRoot, "shared", "coder"))?.summary, "Final coder state.");
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
