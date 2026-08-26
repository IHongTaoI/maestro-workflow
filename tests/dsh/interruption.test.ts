import assert from "node:assert/strict";
import test from "node:test";

import { compileTaskGraph } from "../../src/dsh/compile-workflow.ts";
import { parseTaskGraph } from "../../src/task-graph/parse.ts";
import { validateTaskGraph } from "../../src/task-graph/validate.ts";

test("stops later workflow layers when a role requests user input", async () => {
  const graph = validateTaskGraph(parseTaskGraph(`
name: interrupted
tasks:
  - id: requirements
    role: tpm
    description: Confirm product scope.
  - id: implementation
    role: coder
    description: Implement the confirmed scope.
    depends: [requirements]
`));
  const request = compileTaskGraph(graph);
  const calls: string[] = [];
  const execute = new Function("phase", "parallel", "agent", "args", `return (async () => {\n${request.script}\n})();`) as (
    phase: (name: string) => void,
    parallel: (items: Array<() => Promise<unknown>>) => Promise<unknown[]>,
    agent: (prompt: string, meta: { label: string }) => Promise<unknown>,
    args: typeof request.args,
  ) => Promise<{ graph: string; tasks: Record<string, { summary: string; blockers: string[]; needsUserInput?: unknown }> }>;

  const result = await execute(
    () => undefined,
    async (items) => Promise.all(items.map(async (item) => item())),
    async (_prompt, meta) => {
      calls.push(meta.label);
      if (meta.label !== "requirements") throw new Error("downstream task should not run");
      return {
        summary: "Need a product decision.",
        artifacts: [],
        blockers: [],
        needsUserInput: { question: "Export all rows?", context: "Scope is ambiguous." },
      };
    },
    request.args,
  );

  assert.deepEqual(calls, ["requirements"]);
  assert.match(result.tasks.requirements?.blockers.join(" ") ?? "", /user input/);
  assert.match(result.tasks.implementation?.summary ?? "", /Not run/);
  assert.match(result.tasks.implementation?.blockers.join(" ") ?? "", /interrupted/);
});
