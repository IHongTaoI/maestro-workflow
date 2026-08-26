import assert from "node:assert/strict";
import test from "node:test";

import { TaskGraphParseError, parseTaskGraph } from "../../src/task-graph/parse.ts";

test("parses the YAML graph syntax used by the v3 design", () => {
  const graph = parseTaskGraph(`
name: delivery
tasks:
  - id: specification
    role: tpm
    description: Define the scope and acceptance criteria.
    depends: []
    acceptance:
      - Requirements are explicit.
  - id: architecture
    role: architect
    description: Design the implementation.
    depends: [specification]
`);

  assert.deepEqual(graph, {
    name: "delivery",
    tasks: [
      {
        id: "specification",
        role: "tpm",
        description: "Define the scope and acceptance criteria.",
        depends: [],
        acceptance: ["Requirements are explicit."],
        writes: [],
        maxAttempts: 3,
      },
      {
        id: "architecture",
        role: "architect",
        description: "Design the implementation.",
        depends: ["specification"],
        acceptance: [],
        writes: [],
        maxAttempts: 3,
      },
    ],
  });
});

test("rejects a YAML document whose root is not a mapping", () => {
  assert.throws(
    () => parseTaskGraph("- task"),
    (error: unknown) => error instanceof TaskGraphParseError && error.message.includes("root"),
  );
});

test("rejects non-array dependencies before compilation", () => {
  assert.throws(
    () => parseTaskGraph("tasks:\n  - id: a\n    role: tpm\n    description: a\n    depends: b"),
    (error: unknown) => error instanceof TaskGraphParseError && error.message.includes("depends"),
  );
});
