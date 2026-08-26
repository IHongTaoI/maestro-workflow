import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
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

function memoryWithCandidate(request) {
  return {
    status: "completed",
    current: { content: { ...request.current_memory, compressed: true } },
    references: [],
    long_term_candidates: [
      {
        title: "Runtime boundary",
        content: "The Runtime provides storage contracts but does not choose business stages.",
      },
    ],
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
  assert.match(task.memory_pending_id, /^memory-/);
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

test("Memory Worker candidates remain pending until explicitly reviewed", async () => {
  const root = await project();
  const runtime = new MaestroRuntime(root, { memoryRunner: memoryWithCandidate });
  await runtime.init();
  const temporary = await runtime.createTemporary({ title: "Capture architecture" });
  const task = await runtime.createTask({
    temporaryId: temporary.id,
    objective: "Capture architecture",
    confirmed: true,
  });

  const pending = await runtime.listLongTermCandidates("pending");
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].source_refs, [
    `memory/temporary/archive/${temporary.id}/current.json`,
  ]);

  const review = await runtime.reviewLongTermCandidate({
    candidateId: pending[0].id,
    approved: true,
    reviewer: "old-zhou",
    rationale: "Stable architectural boundary",
  });
  assert.equal(review.status, "approved");
  assert.equal((await runtime.listLongTermCandidates("pending")).length, 0);

  const longTerm = JSON.parse(
    await readFile(path.join(root, ".maestro", "memory/long-term/current.json"), "utf8"),
  );
  assert.equal(longTerm.entries.length, 1);
  assert.equal(longTerm.entries[0].candidate_id, pending[0].id);
  assert.equal(longTerm.entries[0].review.reviewer, "old-zhou");
  assert.equal(task.status, "active");
});

test("rejected long-term candidates are retained without promotion", async () => {
  const root = await project();
  const runtime = new MaestroRuntime(root, { memoryRunner: memoryWithCandidate });
  await runtime.init();
  const temporary = await runtime.createTemporary({ title: "Candidate" });
  await runtime.createTask({ temporaryId: temporary.id, objective: "Candidate", confirmed: true });
  const [candidate] = await runtime.listLongTermCandidates("pending");

  const review = await runtime.reviewLongTermCandidate({
    candidateId: candidate.id,
    approved: false,
    reviewer: "old-zhou",
    rationale: "Not stable enough",
  });

  assert.equal(review.status, "rejected");
  assert.equal((await runtime.listLongTermCandidates("rejected")).length, 1);
  const longTerm = JSON.parse(
    await readFile(path.join(root, ".maestro", "memory/long-term/current.json"), "utf8"),
  );
  assert.equal(longTerm.entries.length, 0);
});

test("Task completion writes a final record and archives the Task", async () => {
  const root = await project();
  const runtime = new MaestroRuntime(root, { memoryRunner: completedMemory });
  await runtime.init();
  const temporary = await runtime.createTemporary({ title: "Finish work" });
  const task = await runtime.createTask({
    temporaryId: temporary.id,
    objective: "Finish work",
    confirmed: true,
  });

  const completed = await runtime.completeTask({
    taskId: task.id,
    summary: "All acceptance checks passed.",
  });

  assert.equal(completed.status, "completed");
  assert.equal(completed.memory_status, "completed");
  const archivedBase = path.join(root, ".maestro", "tasks/archive", task.id);
  const metadata = JSON.parse(await readFile(path.join(archivedBase, "task.json"), "utf8"));
  assert.equal(metadata.status, "completed");
  const completion = JSON.parse(await readFile(path.join(archivedBase, "completion.json"), "utf8"));
  assert.equal(completion.summary, "All acceptance checks passed.");
});

test("Task completion preserves final Reference anchors in the archive", async () => {
  const root = await project();
  const runtime = new MaestroRuntime(root, {
    memoryRunner: async (request) => ({
      status: "completed",
      current: { content: request.current_memory },
      references: [{ title: "Final verification", content: "All tests passed." }],
    }),
  });
  await runtime.init();
  const temporary = await runtime.createTemporary({ title: "Reference archive" });
  const task = await runtime.createTask({
    temporaryId: temporary.id,
    objective: "Reference archive",
    confirmed: true,
  });
  await runtime.completeTask({ taskId: task.id, summary: "Done." });

  const archivedBase = path.join(root, ".maestro", "tasks/archive", task.id);
  const completion = JSON.parse(await readFile(path.join(archivedBase, "completion.json"), "utf8"));
  assert.equal(completion.history_refs.length, 1);
  assert.equal((await readdir(path.join(archivedBase, "references"))).length, 2);
});

test("Task completion archives safely when Memory Worker is pending", async () => {
  const root = await project();
  const bootstrap = new MaestroRuntime(root, { memoryRunner: completedMemory });
  await bootstrap.init();
  const temporary = await bootstrap.createTemporary({ title: "Finish without model" });
  const task = await bootstrap.createTask({
    temporaryId: temporary.id,
    objective: "Finish without model",
    confirmed: true,
  });
  const runtime = new MaestroRuntime(root);

  const completed = await runtime.completeTask({ taskId: task.id, summary: "Done." });
  assert.equal(completed.status, "completed");
  assert.equal(completed.memory_status, "pending");
  assert.match(completed.memory_pending_id, /^memory-/);
  await readFile(path.join(root, ".maestro", "tasks/archive", task.id, "completion.json"), "utf8");
  const pending = JSON.parse(
    await readFile(
      path.join(root, ".maestro", "memory/pending", `${completed.memory_pending_id}.json`),
      "utf8",
    ),
  );
  assert.ok(pending.request.source_files.every((source) => source.includes("tasks/archive/")));
});
