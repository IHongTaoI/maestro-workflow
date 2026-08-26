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

test("accepts controlled version and title compatibility aliases", () => {
  assert.deepEqual(parseTaskGraph(`
version: 1
name: compatibility
tasks:
  - id: inspect
    role: laborer
    title: Inspect the current behavior.
`), {
    name: "compatibility",
    tasks: [{
      id: "inspect",
      role: "laborer",
      description: "Inspect the current behavior.",
      depends: [],
      acceptance: [],
      writes: [],
      maxAttempts: 3,
    }],
  });
});

test("rejects unsupported graph versions and ambiguous task descriptions", () => {
  assert.throws(
    () => parseTaskGraph("version: 2\ntasks: []"),
    (error: unknown) => error instanceof TaskGraphParseError && error.message.includes("version must be 1"),
  );
  assert.throws(
    () => parseTaskGraph("tasks:\n  - id: a\n    role: tpm\n    title: A\n    description: B"),
    (error: unknown) => error instanceof TaskGraphParseError && error.message.includes("must not contain both"),
  );
});
