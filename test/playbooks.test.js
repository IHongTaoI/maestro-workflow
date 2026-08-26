import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MaestroRuntime, ValidationError } from "../src/index.js";

test("Playbooks can be listed and read without being interpreted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maestro-playbook-test-"));
  const runtime = new MaestroRuntime(root);
  await runtime.init();
  await writeFile(path.join(root, ".maestro", "playbooks", "release.md"), "# Release\n\nOptional checks.\n");
  await writeFile(path.join(root, ".maestro", "playbooks", "review.json"), '{"name":"review"}\n');
  await writeFile(path.join(root, ".maestro", "playbooks", "ignored.txt"), "ignore me\n");

  assert.deepEqual(await runtime.listPlaybooks(), ["release.md", "review.json"]);
  assert.match((await runtime.readPlaybook("release.md")).content, /Optional checks/);
  assert.deepEqual((await runtime.readPlaybook("review.json")).content, { name: "review" });
});

test("Playbook reads reject traversal and unsupported extensions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maestro-playbook-test-"));
  const runtime = new MaestroRuntime(root);
  await runtime.init();

  await assert.rejects(runtime.readPlaybook("../config.json"), ValidationError);
  await assert.rejects(runtime.readPlaybook("notes.txt"), ValidationError);
});
