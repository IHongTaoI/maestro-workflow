import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createTask,
  loadTask,
  reviseTask,
  TaskAlreadyExistsError,
} from "../../src/task-memory/task-store.ts";
import { parseTaskGraph } from "../../src/task-graph/parse.ts";
import { validateTaskGraph } from "../../src/task-graph/validate.ts";

const clock = () => new Date("2026-08-25T12:00:00.000Z");

function graph(description = "Inspect the requested scope.") {
  return validateTaskGraph(parseTaskGraph(`
name: health-delivery
tasks:
  - id: requirements
    role: tpm
    description: ${JSON.stringify(description)}
`));
}

async function withProject(run: (projectRoot: string) => Promise<void>): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), "maestro-v3-task-store-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("creates and reloads a versioned task with a deterministic graph digest", async () => {
  await withProject(async (projectRoot) => {
    const created = await createTask({ projectRoot, taskId: "health", graph: graph(), clock });
    const loaded = await loadTask({ projectRoot, taskId: "health" });

    assert.equal(created.status, "ready");
    assert.equal(created.revision, 1);
    assert.match(created.graphDigest, /^[a-f0-9]{64}$/);
    assert.equal(created.createdAt, "2026-08-25T12:00:00.000Z");
    assert.deepEqual(loaded, created);
  });
});

test("refuses duplicate task creation instead of replacing persisted history", async () => {
  await withProject(async (projectRoot) => {
    await createTask({ projectRoot, taskId: "health", graph: graph(), clock });

    await assert.rejects(
      createTask({ projectRoot, taskId: "health", graph: graph("Replacement."), clock }),
      TaskAlreadyExistsError,
    );
  });
});

test("revises an idle task with a monotonic revision and new digest", async () => {
  await withProject(async (projectRoot) => {
    const original = await createTask({ projectRoot, taskId: "health", graph: graph(), clock });
    const revised = await reviseTask({
      projectRoot,
      taskId: "health",
      graph: graph("Inspect the revised scope."),
      clock: () => new Date("2026-08-25T12:01:00.000Z"),
    });

    assert.equal(revised.revision, 2);
    assert.equal(revised.status, "ready");
    assert.notEqual(revised.graphDigest, original.graphDigest);
    assert.equal(revised.updatedAt, "2026-08-25T12:01:00.000Z");
  });
});
