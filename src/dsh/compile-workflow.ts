import type { Task, TaskGraph } from "../task-graph/types.ts";
import type { PersistedTaskContext } from "../task-memory/contracts.ts";
import { TASK_RESULT_SCHEMA, type CompiledLayer, type DshWorkflowRequest } from "./workflow-contract.ts";

const WORKFLOW_SCRIPT = `const results = {};
for (const layer of args.layers) {
  phase(layer.phase);
  const batchResults = await parallel(layer.tasks.map((task) => async () => {
    const dependencies = Object.fromEntries(task.depends.map((dependencyId) => [dependencyId, results[dependencyId]]));
    const persistedContext = args.taskContext === undefined ? null : {
      taskId: args.taskContext.taskId,
      taskRevision: args.taskContext.taskRevision,
      runId: args.taskContext.runId,
      projectWiki: args.taskContext.projectWiki ?? [],
      memory: args.taskContext.roleMemory?.[task.role]?.memory ?? args.taskContext.memory,
      roleState: args.taskContext.roleMemory?.[task.role]?.state ?? null,
    };
    const prompt = [
      "You are the Maestro " + task.role + " role.",
      "Task: " + task.description,
      "Acceptance criteria: " + JSON.stringify(task.acceptance),
      "Completed dependency results: " + JSON.stringify(dependencies),
      "Persisted task context for this role: " + JSON.stringify(persistedContext),
      "Return only a JSON result that matches the supplied schema.",
    ].join("\\n");
    let result = null;
    for (let attempt = 1; attempt <= task.maxAttempts; attempt += 1) {
      result = await agent(prompt + "\\nAttempt: " + attempt + "/" + task.maxAttempts, { label: task.id, phase: layer.phase, schema: args.resultSchema });
      if (result !== null) break;
    }
    return result;
  }));

  layer.tasks.forEach((task, index) => {
    const result = batchResults[index];
    if (result === null) throw new Error("Task failed: " + task.id);
    results[task.id] = result;
  });
}
return { graph: args.graphName, tasks: results };`;

function pathsConflict(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = left.map((path) => path.replaceAll("\\", "/").replace(/\/$/, ""));
  const normalizedRight = right.map((path) => path.replaceAll("\\", "/").replace(/\/$/, ""));
  return normalizedLeft.some((leftPath) => normalizedRight.some((rightPath) => (
    leftPath === rightPath || leftPath.startsWith(`${rightPath}/`) || rightPath.startsWith(`${leftPath}/`)
  )));
}

export function dependencyLayers(graph: TaskGraph): CompiledLayer[] {
  const outstanding = new Map<string, Task>(graph.tasks.map((task) => [task.id, task]));
  const completed = new Set<string>();
  const layers: CompiledLayer[] = [];

  while (outstanding.size > 0) {
    const candidates = graph.tasks.filter((task) => {
      return outstanding.has(task.id) && task.depends.every((dependency) => completed.has(dependency));
    });
    if (candidates.length === 0) throw new Error("cannot compile a task graph with unresolved dependencies");
    const ready: Task[] = [];
    for (const candidate of candidates) {
      if (ready.every((selected) => !pathsConflict(selected.writes, candidate.writes))) ready.push(candidate);
    }

    const phase = `layer-${layers.length + 1}`;
    layers.push({
      phase,
      tasks: ready.map((task) => ({
        id: task.id,
        role: task.role,
        description: task.description,
        depends: [...task.depends],
        acceptance: [...task.acceptance],
        writes: [...task.writes],
        maxAttempts: task.maxAttempts,
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
