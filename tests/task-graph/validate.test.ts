import assert from "node:assert/strict";
import test from "node:test";

import { parseTaskGraph } from "../../src/task-graph/parse.ts";
import { TaskGraphValidationError, validateTaskGraph } from "../../src/task-graph/validate.ts";

const validGraph = `
name: delivery
tasks:
  - id: requirements
    role: tpm
    description: Define the scope.
  - id: design
    role: architect
    description: Design the system.
    depends: [requirements]
`;

test("accepts a valid directed acyclic task graph", () => {
  const graph = validateTaskGraph(parseTaskGraph(validGraph));
  assert.equal(graph.tasks[1]?.depends[0], "requirements");
});

for (const [name, yaml, expected] of [
  ["invalid task ids", "tasks:\n  - id: Bad ID\n    role: tpm\n    description: Define scope.", "id"],
  ["unknown roles", "tasks:\n  - id: task\n    role: wizard\n    description: Define scope.", "role"],
  ["duplicate task ids", "tasks:\n  - id: task\n    role: tpm\n    description: First.\n  - id: task\n    role: coder\n    description: Second.", "duplicate"],
  ["unknown dependencies", "tasks:\n  - id: task\n    role: tpm\n    description: Define scope.\n    depends: [missing]", "unknown task"],
  ["self dependencies", "tasks:\n  - id: task\n    role: tpm\n    description: Define scope.\n    depends: [task]", "itself"],
  ["duplicate dependency edges", "tasks:\n  - id: first\n    role: tpm\n    description: Define scope.\n  - id: task\n    role: coder\n    description: Build.\n    depends: [first, first]", "duplicate dependency"],
  ["cycles", "tasks:\n  - id: first\n    role: tpm\n    description: First.\n    depends: [second]\n  - id: second\n    role: coder\n    description: Second.\n    depends: [first]", "cycle"],
] as const) {
  test(`rejects ${name}`, () => {
    assert.throws(
      () => validateTaskGraph(parseTaskGraph(yaml)),
      (error: unknown) => error instanceof TaskGraphValidationError && error.message.includes(expected),
    );
  });
}
