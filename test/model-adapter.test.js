import assert from "node:assert/strict";
import test from "node:test";

import { createModelRunner, ValidationError } from "../src/index.js";

const normalized = {
  status: "completed",
  current: { content: { objective: "Keep the contract small" } },
};

test("model adapter accepts direct structured responses", async () => {
  const runner = createModelRunner({ model: "memory-small", invoke: async () => normalized });
  assert.deepEqual(await runner({ operation: "session-handoff" }), normalized);
});

test("model adapter extracts JSON from common text response shapes", async () => {
  const runner = createModelRunner({
    model: "memory-small",
    tier: "memory",
    invoke: async ({ model, tier }) => {
      assert.equal(model, "memory-small");
      assert.equal(tier, "memory");
      return { content: [{ type: "text", text: `\`\`\`json\n${JSON.stringify(normalized)}\n\`\`\`` }] };
    },
  });
  assert.deepEqual(await runner({ operation: "session-handoff" }), normalized);
});

test("model adapter rejects malformed model output", async () => {
  const runner = createModelRunner({ model: "memory-small", invoke: async () => "not json" });
  await assert.rejects(runner({ operation: "session-handoff" }), ValidationError);
});
