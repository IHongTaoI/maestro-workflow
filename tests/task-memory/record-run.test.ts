import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { artifactContentPath, artifactMetadataPath } from "../../src/task-memory/paths.ts";
import { recordTaskRun, TaskRunRecordError } from "../../src/task-memory/record-run.ts";
import { prepareTaskRun, recoverTaskRunState } from "../../src/task-memory/task-run.ts";
import { createTask, loadTask, persistTask } from "../../src/task-memory/task-store.ts";
import { parseTaskGraph } from "../../src/task-graph/parse.ts";
import { validateTaskGraph } from "../../src/task-graph/validate.ts";

function graph() {
  return validateTaskGraph(parseTaskGraph(`
name: health-delivery
tasks:
  - id: requirements
    role: tpm
    description: Write the health command requirements.
`));
}

function result(overrides: { blockers?: string[]; artifacts?: Array<{ path: string; description: string }> } = {}) {
  return {
    graph: "health-delivery",
    tasks: {
      requirements: {
        summary: "The health command reports dependency state.",
        artifacts: overrides.artifacts ?? [],
        blockers: overrides.blockers ?? [],
      },
    },
  };
}

async function withProject(run: (projectRoot: string) => Promise<void>): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), "maestro-v3-record-run-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("records a completed DSH result, snapshots its artifact, and derives project memory", async () => {
  await withProject(async (projectRoot) => {
    await createTask({ projectRoot, taskId: "health", graph: graph() });
    await prepareTaskRun({ projectRoot, taskId: "health" });
    await mkdir(join(projectRoot, "requirements"));
    await writeFile(join(projectRoot, "requirements", "spec.md"), "# Health command\n");

    const recorded = await recordTaskRun({
      projectRoot,
      taskId: "health",
      result: result({ artifacts: [{ path: "requirements/spec.md", description: "Approved requirements." }] }),
      clock: () => new Date("2026-08-25T12:02:00.000Z"),
    });

    assert.equal(recorded.task.status, "completed");
    assert.equal(recorded.task.activeRunId, undefined);
    assert.equal(recorded.run.status, "completed");
    assert.equal(recorded.artifacts.length, 1);
    const artifact = recorded.artifacts[0];
    assert.ok(artifact);
    assert.equal(await readFile(artifactContentPath(projectRoot, artifact.id), "utf8"), "# Health command\n");
    assert.equal(JSON.parse(await readFile(artifactMetadataPath(projectRoot, artifact.id), "utf8")).sha256, artifact.sha256);
    assert.match(recorded.memory.text, /health command reports dependency state/i);
    assert.equal((await loadTask({ projectRoot, taskId: "health" })).status, "completed");
  });
});

test("records blockers as a durable blocked task rather than a completed task", async () => {
  await withProject(async (projectRoot) => {
    await createTask({ projectRoot, taskId: "health", graph: graph() });
    await prepareTaskRun({ projectRoot, taskId: "health" });

    const recorded = await recordTaskRun({ projectRoot, taskId: "health", result: result({ blockers: ["Need product owner decision."] }) });

    assert.equal(recorded.task.status, "blocked");
    assert.match(recorded.memory.text, /Need product owner decision/);
  });
});

test("rejects a second record attempt and invalid Artifact references without changing task history", async () => {
  await withProject(async (projectRoot) => {
    await createTask({ projectRoot, taskId: "health", graph: graph() });
    await prepareTaskRun({ projectRoot, taskId: "health" });

    await assert.rejects(
      recordTaskRun({ projectRoot, taskId: "health", result: result({ artifacts: [{ path: "../outside.md", description: "Escape." }] }) }),
      TaskRunRecordError,
    );
    assert.equal((await loadTask({ projectRoot, taskId: "health" })).status, "running");

    await recordTaskRun({ projectRoot, taskId: "health", result: result() });
    await assert.rejects(recordTaskRun({ projectRoot, taskId: "health", result: result() }), TaskRunRecordError);
  });
});

test("recovers a completed result when a crash leaves task.json active", async () => {
  await withProject(async (projectRoot) => {
    await createTask({ projectRoot, taskId: "health", graph: graph() });
    await prepareTaskRun({ projectRoot, taskId: "health" });
    const recorded = await recordTaskRun({ projectRoot, taskId: "health", result: result() });
    await persistTask(projectRoot, { ...recorded.task, status: "running", activeRunId: recorded.run.id });

    const recovered = await recoverTaskRunState({ projectRoot, taskId: "health" });
    assert.equal(recovered.recovered, "recorded-result");
    assert.equal(recovered.task.status, "completed");
    assert.equal(recovered.task.activeRunId, undefined);
  });
});
