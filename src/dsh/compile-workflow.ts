import type { Task, TaskGraph } from "../task-graph/types.ts";
import type { PersistedTaskContext } from "../task-memory/contracts.ts";
import { TASK_RESULT_SCHEMA, type CompiledLayer, type DshWorkflowRequest } from "./workflow-contract.ts";

const WORKFLOW_SCRIPT = `const results = {};
for (const layer of args.layers) {
  phase(layer.phase);
  const batchResults = await parallel(layer.tasks.map((task) => async () => {
    const dependencies = Object.fromEntries(task.depends.map((dependencyId) => [dependencyId, results[dependencyId]]));
    const prompt = [
      "You are the Maestro " + task.role + " role.",
      "Task: " + task.description,
      "Acceptance criteria: " + JSON.stringify(task.acceptance),
      "Completed dependency results: " + JSON.stringify(dependencies),
      "Persisted task context: " + JSON.stringify(args.taskContext ?? null),
      "Return only a JSON result that matches the supplied schema.",
    ].join("\\n");
    return await agent(prompt, { label: task.id, phase: layer.phase, schema: args.resultSchema });
  }));

  layer.tasks.forEach((task, index) => {
    const result = batchResults[index];
    if (result === null) throw new Error("Task failed: " + task.id);
    results[task.id] = result;
  });
}
return { graph: args.graphName, tasks: results };`;

function dependencyLayers(graph: TaskGraph): CompiledLayer[] {
  const outstanding = new Map<string, Task>(graph.tasks.map((task) => [task.id, task]));
  const completed = new Set<string>();
  const layers: CompiledLayer[] = [];

  while (outstanding.size > 0) {
    const ready = graph.tasks.filter((task) => {
      return outstanding.has(task.id) && task.depends.every((dependency) => completed.has(dependency));
    });
    if (ready.length === 0) throw new Error("cannot compile a task graph with unresolved dependencies");

    const phase = `layer-${layers.length + 1}`;
    layers.push({
      phase,
      tasks: ready.map((task) => ({
        id: task.id,
        role: task.role,
        description: task.description,
        depends: [...task.depends],
        acceptance: [...task.acceptance],
      })),
    });
    for (const task of ready) {
      outstanding.delete(task.id);
      completed.add(task.id);
    }
  }

  return layers;
}

/**
 * Compiles a validated static graph to the data accepted by DSH's `workflow` tool.
 * User YAML becomes JSON args only; it never becomes executable workflow source.
 */
export type CompileTaskGraphOptions = {
  taskContext?: PersistedTaskContext;
};

export function compileTaskGraph(graph: TaskGraph, options: CompileTaskGraphOptions = {}): DshWorkflowRequest {
  const layers = dependencyLayers(graph);
  return {
    script: WORKFLOW_SCRIPT,
    meta: {
      name: `maestro-${graph.name}`,
      description: `Execute the Maestro task graph "${graph.name}".`,
      whenToUse: "Use after the user has approved a validated Maestro task graph.",
      phases: layers.map((layer) => ({
        title: layer.phase,
        detail: `Run ${layer.tasks.map((task) => task.id).join(", ")}.`,
      })),
    },
    args: {
      graphName: graph.name,
      layers,
      resultSchema: TASK_RESULT_SCHEMA,
      ...(options.taskContext === undefined ? {} : { taskContext: options.taskContext }),
    },
  };
}
