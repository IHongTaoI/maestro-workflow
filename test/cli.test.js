import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.js";

function output() {
  let value = "";
  return {
    io: { stdout: { write: (chunk) => { value += chunk; } } },
    json: () => JSON.parse(value),
  };
}

test("CLI exposes Playbook discovery and reads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maestro-cli-test-"));
  let capture = output();
  await runCli(["init", "--root", root], capture.io);
  assert.equal(capture.json().status, "initialized");
  await writeFile(path.join(root, ".maestro", "playbooks", "release.md"), "# Release\n");

  capture = output();
  await runCli(["playbook-list", "--root", root], capture.io);
  assert.deepEqual(capture.json(), ["release.md"]);

  capture = output();
  await runCli(["playbook-read", "--root", root, "--name", "release.md"], capture.io);
  assert.equal(capture.json().format, "markdown");
});
