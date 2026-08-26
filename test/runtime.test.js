import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ConfirmationRequiredError, MaestroRuntime } from "../src/index.js";

async function project() {
  return mkdtemp(path.join(os.tmpdir(), "maestro-v1-test-"));
}

function completedMemory(request) {
  return {
    status: "completed",
    current: { content: { ...request.current_memory, compressed: true } },
    references: [],
  };
}

test("discussion starts in Temporary Memory without creating a Task", async () => {
  const root = await project();
  const runtime = new MaestroRuntime(root);
  await runtime.init();
  const temporary = await runtime.createTemporary({
    title: "Explore a lighter architecture",
    content: { objective: "Discuss before committing" },
  });

  const current = JSON.parse(
    await readFile(path.join(root, ".maestro", temporary.path, "current.json"), "utf8"),
  );
  assert.equal(current.objective, "Discuss before committing");
  await assert.rejects(
    readFile(path.join(root, ".maestro", "tasks", "task.json"), "utf8"),
  );
});

test("formal Task requires explicit confirmation", async () => {
  const root = await project();
  const runtime = new MaestroRuntime(root);
  await runtime.init();
  const temporary = await runtime.createTemporary({ title: "Candidate work" });

  await assert.rejects(
    runtime.createTask({ temporaryId: temporary.id, objective: "Do the work" }),
    ConfirmationRequiredError,
  );
});

test("confirmed Task is bootstrapped and Temporary Memory is archived", async () => {
  const root = await project();
  const runtime = new MaestroRuntime(root, { memoryRunner: completedMemory });
  await runtime.init();
  const temporary = await runtime.createTemporary({
    title: "Candidate work",
    content: { objective: "Build the first slice" },
  });
  const task = await runtime.createTask({
    temporaryId: temporary.id,
    objective: "Build the first slice",
    confirmed: true,
  });

  const metadata = JSON.parse(
    await readFile(path.join(root, ".maestro", task.path, "task.json"), "utf8"),
  );
  assert.equal(metadata.status, "active");
  assert.equal(task.memory_status, "completed");
  const archived = path.join(
    root,
    ".maestro",
    "memory/temporary/archive",
    temporary.id,
    "meta.json",
  );
  assert.equal(JSON.parse(await readFile(archived, "utf8")).promoted_to_task, task.id);
});

test("role run persists detailed result, Current State and lightweight Handoff", async () => {
  const root = await project();
  const runtime = new MaestroRuntime(root, { memoryRunner: completedMemory });
  await runtime.init();
  const temporary = await runtime.createTemporary({ title: "Investigate" });
  const task = await runtime.createTask({
    temporaryId: temporary.id,
    objective: "Investigate behavior",
    confirmed: true,
  });
  const handoff = await runtime.recordRoleRun({
    taskId: task.id,
    role: "laborer",
    result: {
      status: "completed",
      summary: "Confirmed the current call path.",
      key_findings: ["Entry point located"],
      recommended_next: [{ role: "architect", reason: "Evaluate boundaries" }],
    },
  });

  assert.equal(handoff.summary, "Confirmed the current call path.");
  assert.equal(handoff.needs_user_input, false);
  assert.match(handoff.result_path, /roles\/laborer\/runs/);
  assert.match(handoff.role_state_path, /roles\/laborer\/current-state\.json$/);
  assert.equal(
    JSON.parse(await readFile(path.join(root, ".maestro", handoff.handoff_path), "utf8")).status,
    "completed",
  );
});

test("missing model records memory_pending and keeps the business Task running", async () => {
  const root = await project();
  const runtime = new MaestroRuntime(root);
  await runtime.init();
  const temporary = await runtime.createTemporary({ title: "No model configured" });
  const task = await runtime.createTask({
    temporaryId: temporary.id,
    objective: "Continue safely",
    confirmed: true,
  });
  assert.equal(task.status, "active");
  assert.equal(task.memory_status, "pending");
});

test("later memory compression keeps earlier Reference anchors", async () => {
  const root = await project();
  let calls = 0;
  const runtime = new MaestroRuntime(root, {
    memoryRunner: async (request) => {
      calls += 1;
      return {
        status: "completed",
        current: { content: { ...request.current_memory, revision: calls } },
        references: [{ title: `history-${calls}`, content: `phase ${calls}` }],
      };
    },
  });
  await runtime.init();
  const temporary = await runtime.createTemporary({ title: "Long discussion" });
  await runtime.handoffTemporary(temporary.id);
  await runtime.handoffTemporary(temporary.id);

  const current = JSON.parse(
    await readFile(
      path.join(root, ".maestro", temporary.path, "current.json"),
      "utf8",
    ),
  );
  assert.equal(current.history_refs.length, 2);
});
