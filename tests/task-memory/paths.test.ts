import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  artifactContentPath,
  artifactDirectory,
  memoryEntryPath,
  projectStateRoot,
  runReceiptPath,
  taskDirectory,
  taskRecordPath,
  TaskMemoryPathError,
} from "../../src/task-memory/paths.ts";

test("task memory paths stay below the fixed .maestro project root", () => {
  const projectRoot = resolve("C:/maestro-project");
  const stateRoot = projectStateRoot(projectRoot);

  assert.equal(stateRoot, resolve(projectRoot, ".maestro"));
  assert.equal(taskDirectory(projectRoot, "health-check"), resolve(stateRoot, "tasks", "health-check"));
  assert.equal(taskRecordPath(projectRoot, "health-check"), resolve(stateRoot, "tasks", "health-check", "task.json"));
  assert.equal(runReceiptPath(projectRoot, "health-check", "run-000001"), resolve(stateRoot, "tasks", "health-check", "runs", "run-000001.json"));
  assert.equal(artifactDirectory(projectRoot, "artifact-001"), resolve(stateRoot, "artifacts", "artifact-001"));
  assert.equal(artifactContentPath(projectRoot, "artifact-001"), resolve(stateRoot, "artifacts", "artifact-001", "content"));
  assert.equal(memoryEntryPath(projectRoot, "memory-001"), resolve(stateRoot, "memory", "memory-001.json"));
});

test("task memory paths reject identifiers that could escape project state", () => {
  const projectRoot = resolve("C:/maestro-project");

  for (const invalidId of ["", "../escape", "UPPER", "has space", "a/b", "-leading"]) {
    assert.throws(() => taskRecordPath(projectRoot, invalidId), TaskMemoryPathError);
  }
  assert.throws(() => runReceiptPath(projectRoot, "health", "not-a-run"), TaskMemoryPathError);
  assert.throws(() => artifactDirectory(projectRoot, "../artifact"), TaskMemoryPathError);
});
