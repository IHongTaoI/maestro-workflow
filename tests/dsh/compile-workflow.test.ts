import assert from "node:assert/strict";
import test from "node:test";

import { compileTaskGraph } from "../../src/dsh/compile-workflow.ts";
import { parseTaskGraph } from "../../src/task-graph/parse.ts";
import { validateTaskGraph } from "../../src/task-graph/validate.ts";

test("compiles dependency layers into a deterministic DSH workflow request", () => {
  const graph = validateTaskGraph(parseTaskGraph(`
name: delivery
tasks:
  - id: requirements
    role: tpm
    description: Define the scope.
  - id: design
    role: architect
    description: Design the system.
  - id: implementation
    role: coder
    description: Implement the approved design.
    depends: [requirements, design]
`));

  const request = compileTaskGraph(graph);

  assert.deepEqual(request.meta.phases?.map((phase) => phase.title), ["layer-1", "layer-2"]);
  assert.deepEqual(request.args.layers.map((layer) => layer.tasks.map((task) => task.id)), [
    ["requirements", "design"],
    ["implementation"],
  ]);
  assert.match(request.script, /await parallel\(layer\.tasks\.map/);
  assert.match(request.script, /await agent\(prompt/);
  assert.match(request.script, /phase\(layer\.phase\)/);
  assert.doesNotMatch(request.script, /Implement the approved design/);
  assert.doesNotThrow(() => new Function(`return (async () => {\n${request.script}\n})();`));
});

test("keeps untrusted YAML strings in workflow args rather than source code", () => {
  const graph = validateTaskGraph(parseTaskGraph(`
tasks:
  - id: task
    role: tpm
    description: '"; throw new Error("injected"); //'
`));

  const request = compileTaskGraph(graph);

  assert.doesNotMatch(request.script, /injected/);
  assert.equal(request.args.layers[0]?.tasks[0]?.description, '"; throw new Error("injected"); //');
});

test("keeps persisted task context in workflow args rather than executable source", () => {
  const graph = validateTaskGraph(parseTaskGraph(`
tasks:
  - id: task
    role: tpm
    description: Inspect the scope.
`));

  const request = compileTaskGraph(graph, {
    taskContext: {
      taskId: "health",
      taskRevision: 2,
      runId: "run-000003",
      memory: [{
        id: "memory-health-run-000001",
        taskId: "health",
        runId: "run-000001",
        tags: ["health"],
        text: "Never retry when the database is unavailable.",
      }],
    },
  });

  assert.equal(request.args.taskContext?.taskId, "health");
  assert.doesNotMatch(request.script, /Never retry when the database is unavailable/);
  assert.match(request.script, /Persisted task context/);
});
