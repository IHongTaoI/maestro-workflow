import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { atomicWriteFile } from "../../src/runtime/atomic.ts";
import { TaskLockConflictError, withTaskLock } from "../../src/runtime/task-lock.ts";

test("atomically replaces state and rejects a concurrent writer", async () => {
  const root = await mkdtemp(join(tmpdir(), "maestro-atomic-"));
  try {
    const state = join(root, "state.json");
    await atomicWriteFile(state, "old\n");
    await atomicWriteFile(state, "new\n");
    assert.equal(await readFile(state, "utf8"), "new\n");
    assert.deepEqual((await readdir(root)).filter((name) => name.includes(".tmp-")), []);

    const lock = join(root, "locks", "task.lock");
    await withTaskLock(lock, async () => {
      await assert.rejects(withTaskLock(lock, async () => undefined), TaskLockConflictError);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
