import assert from "node:assert/strict";
import test from "node:test";

import { runMemoryWorker } from "../src/memory-worker.js";

const request = {
  operation: "session-handoff",
  source_files: ["memory/temporary/active/temp/current.json"],
  current_memory: { objective: "Build Maestro" },
  memory_hints: {},
};

test("Memory Worker retries memory model then falls back to primary", async () => {
  let memoryCalls = 0;
  let primaryCalls = 0;
  const outcome = await runMemoryWorker({
    request,
    memoryRunner: async () => {
      memoryCalls += 1;
      throw new Error("small model unavailable");
    },
    primaryRunner: async () => {
      primaryCalls += 1;
      return {
        status: "completed",
        current: { content: { objective: "Build Maestro", open_items: [] } },
        references: [],
      };
    },
  });

  assert.equal(memoryCalls, 2);
  assert.equal(primaryCalls, 1);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.model_tier, "primary");
});

test("Memory Worker returns pending without silently discarding input", async () => {
  const outcome = await runMemoryWorker({ request });
  assert.equal(outcome.status, "pending");
  assert.equal(outcome.reason, "no_model_runner");
  assert.deepEqual(outcome.request, request);
});
