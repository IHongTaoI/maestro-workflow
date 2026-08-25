import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeMemoryEntry } from "../../src/task-memory/memory-store.ts";
import { prepareTaskRun, resumeTaskRun, TaskRunConflictError } from "../../src/task-memory/task-run.ts";
import { loadTask, reviseTask, TaskHasActiveRunError, createTask } from "../../src/task-memory/task-store.ts";
import { parseTaskGraph } from "../../src/task-graph/parse.ts";
import { validateTaskGraph } from "../../src/task-graph/validate.ts";

function graph() {
  return validateTaskGraph(parseTaskGraph(`
name: health-delivery
tasks:
  - id: requirements
    role: tpm
    description: Inspect retry behavior.
`));
}

async function withProject(run: (projectRoot: string) => Promise<void>): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), "maestro-v3-task-run-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("prepares a persisted run and injects only explicitly queried project memory", async () => {
  await withProject(async (projectRoot) => {
    await createTask({ projectRoot, taskId: "health", graph: graph() });
    await writeMemoryEntry({
      projectRoot,
      entry: {
        schemaVersion: 1,
        id: "memory-prior-run-000001",
        taskId: "prior",
        runId: "run-000001",
        tags: ["retry", "database"],
        text: "Do not retry when database credentials are unavailable.",
        sourceArtifactIds: [],
        createdAt: "2026-08-25T12:00:00.000Z",
      },
    });

    const prepared = await prepareTaskRun({
      projectRoot,
      taskId: "health",
      memoryQuery: ["database retry"],
      clock: () => new Date("2026-08-25T12:01:00.000Z"),
    });

    assert.equal(prepared.run.id, "run-000001");
    assert.equal(prepared.workflow.args.taskContext?.taskId, "health");
    assert.deepEqual(prepared.workflow.args.taskContext?.memory.map((entry) => entry.id), ["memory-prior-run-000001"]);
    assert.equal((await loadTask({ projectRoot, taskId: "health" })).activeRunId, "run-000001");
  });
});

test("preparing a run does not retrieve project memory when the query is empty", async () => {
  await withProject(async (projectRoot) => {
    await createTask({ projectRoot, taskId: "health", graph: graph() });

    const prepared = await prepareTaskRun({ projectRoot, taskId: "health", memoryQuery: [] });

    assert.deepEqual(prepared.workflow.args.taskContext?.memory, []);
  });
});

test("resumes an active run with the exact workflow request persisted at preparation time", async () => {
  await withProject(async (projectRoot) => {
    await createTask({ projectRoot, taskId: "health", graph: graph() });
    const prepared = await prepareTaskRun({ projectRoot, taskId: "health", memoryQuery: ["retry database"] });

    const resumed = await resumeTaskRun({ projectRoot, taskId: "health" });

    assert.deepEqual(resumed.workflow, prepared.workflow);
    assert.deepEqual(resumed.run.taskContext, prepared.workflow.args.taskContext);
    assert.match(resumed.run.workflowDigest, /^[a-f0-9]{64}$/);
  });
});

test("refuses to resume a run whose persisted workflow no longer matches its digest", async () => {
  await withProject(async (projectRoot) => {
    await createTask({ projectRoot, taskId: "health", graph: graph() });
    await prepareTaskRun({ projectRoot, taskId: "health" });
    const receiptPath = join(projectRoot, ".maestro", "tasks", "health", "runs", "run-000001.json");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { workflow: { args: { graphName: string } } };
    receipt.workflow.args.graphName = "tampered";
    await writeFile(receiptPath, JSON.stringify(receipt));

    await assert.rejects(resumeTaskRun({ projectRoot, taskId: "health" }), /workflow digest does not match/);
  });
});

test("refuses a second active run and task revision until its run is recorded", async () => {
  await withProject(async (projectRoot) => {
    await createTask({ projectRoot, taskId: "health", graph: graph() });
    await prepareTaskRun({ projectRoot, taskId: "health" });

    await assert.rejects(prepareTaskRun({ projectRoot, taskId: "health" }), TaskRunConflictError);
    await assert.rejects(reviseTask({ projectRoot, taskId: "health", graph: graph() }), TaskHasActiveRunError);
  });
});
