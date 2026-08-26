import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createTemporaryDraft, loadCurrentMemorySummary, promoteWikiEntry, queryWiki, setTemporaryDraftStatus, writeCurrentMemorySummary, writeRoleState } from "../../src/memory/three-layer-store.ts";
import { writeMemoryEntry } from "../../src/task-memory/memory-store.ts";
import { roleHistoryPath, wikiVersionPath } from "../../src/task-memory/paths.ts";
import { createTask, persistTask } from "../../src/task-memory/task-store.ts";

test("keeps drafts, role state and versioned wiki knowledge in separate layers", async () => {
  const root = await mkdtemp(join(tmpdir(), "maestro-three-layer-"));
  try {
    const draft = await createTemporaryDraft({ projectRoot: root, id: "api-draft", text: "Maybe use REST." });
    assert.equal(draft.status, "unconfirmed");
    assert.equal((await setTemporaryDraftStatus({ projectRoot: root, id: draft.id, status: "confirmed" })).status, "confirmed");
    await assert.rejects(setTemporaryDraftStatus({ projectRoot: root, id: draft.id, status: "discarded" }), /already confirmed/);

    const baseState = { schemaVersion: 1 as const, taskId: "api-task", role: "architect", summary: "Designing API.", decisions: [], blockers: [], nextActions: ["Freeze schema."], updatedAt: "2026-08-26T01:00:00.000Z" };
    await writeRoleState({ projectRoot: root, state: baseState });
    await writeRoleState({ projectRoot: root, state: { ...baseState, summary: "API schema frozen.", updatedAt: "2026-08-26T01:01:00.000Z" } });
    assert.match(await readFile(roleHistoryPath(root, "api-task", "architect"), "utf8"), /Designing API/);

    const task = await createTask({ projectRoot: root, taskId: "api-task", graph: { name: "api", tasks: [{ id: "design", role: "architect", description: "Design API", depends: [], acceptance: ["Schema frozen"], writes: ["docs/api.md"], maxAttempts: 3 }] } });
    await writeMemoryEntry({ projectRoot: root, entry: { schemaVersion: 1, id: "memory-api-run-000001", taskId: "api-task", runId: "run-000001", tags: ["api"], text: "REST schema was accepted.", sourceArtifactIds: [], createdAt: "2026-08-26T01:02:00.000Z" } });
    await assert.rejects(promoteWikiEntry({ projectRoot: root, id: "api-contract", title: "API contract", body: "Use the accepted REST schema.", tags: ["api"], sourceMemoryIds: ["memory-api-run-000001"] }), /not completed/);
    await persistTask(root, { ...task, status: "completed", updatedAt: "2026-08-26T01:02:00.000Z" });
    const first = await promoteWikiEntry({ projectRoot: root, id: "api-contract", title: "API contract", body: "Use the accepted REST schema.", tags: ["api"], sourceMemoryIds: ["memory-api-run-000001"] });
    const second = await promoteWikiEntry({ projectRoot: root, id: "api-contract", title: "API contract", body: "Use REST schema revision two.", tags: ["api"], sourceMemoryIds: ["memory-api-run-000001"] });
    assert.equal(first.revision, 1);
    assert.equal(second.revision, 2);
    assert.equal(JSON.parse(await readFile(wikiVersionPath(root, "api-contract", 1), "utf8")).revision, 1);
    assert.equal((await queryWiki(root, ["api"])).at(0)?.revision, 2);
    await writeCurrentMemorySummary({ projectRoot: root, summary: { goal: "Ship API.", decisions: ["Use REST."], constraints: ["No secrets."], frozenVersions: ["requirements-r1"], openQuestions: [], generatedAt: "2026-08-26T01:03:00.000Z", throughMemoryId: "memory-api-run-000001" } });
    assert.equal((await loadCurrentMemorySummary(root))?.throughMemoryId, "memory-api-run-000001");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
