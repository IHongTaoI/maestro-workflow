import { isAbsolute, posix } from "node:path";

import { isMaestroRole, type ParsedTaskGraph, type Task, type TaskGraph } from "./types.ts";

const IDENTIFIER = /^[a-z][a-z0-9-]*$/;

function normalizeWritePath(value: string): string | undefined {
  const input = value.trim().replaceAll("\\", "/");
  if (input === "" || isAbsolute(input) || /^[A-Za-z]:\//.test(input)) return undefined;
  const normalized = posix.normalize(input.replace(/^\.\//, ""));
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) return undefined;
  return normalized;
}

export class TaskGraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskGraphValidationError";
  }
}

function validateCycles(graph: ParsedTaskGraph): void {
  const tasksById = new Map(graph.tasks.map((task) => [task.id, task]));
  const state = new Map<string, "visiting" | "done">();

  const visit = (id: string, ancestry: string[]): void => {
    const taskState = state.get(id);
    if (taskState === "done") return;
    if (taskState === "visiting") {
      throw new TaskGraphValidationError(`task graph contains a cycle: ${[...ancestry, id].join(" -> ")}`);
    }

    state.set(id, "visiting");
    const task = tasksById.get(id);
    if (!task) throw new TaskGraphValidationError(`task graph refers to unknown task "${id}"`);
    for (const dependency of task.depends) visit(dependency, [...ancestry, id]);
    state.set(id, "done");
  };

  for (const task of graph.tasks) visit(task.id, []);
}

export function validateTaskGraph(graph: ParsedTaskGraph): TaskGraph {
  if (!IDENTIFIER.test(graph.name)) {
    throw new TaskGraphValidationError("task graph name must be a lowercase kebab-case identifier");
  }
  if (graph.tasks.length === 0) throw new TaskGraphValidationError("task graph must contain at least one task");

  const ids = new Set<string>();
  const normalizedWrites = new Map<string, string[]>();
  for (const task of graph.tasks) {
    if (!IDENTIFIER.test(task.id)) {
      throw new TaskGraphValidationError(`task id "${task.id}" must be a lowercase kebab-case identifier`);
    }
    if (ids.has(task.id)) throw new TaskGraphValidationError(`duplicate task id "${task.id}"`);
    ids.add(task.id);

    if (!isMaestroRole(task.role)) {
      throw new TaskGraphValidationError(`task "${task.id}" has unsupported role "${task.role}"`);
    }
    if (task.description.trim() === "") {
      throw new TaskGraphValidationError(`task "${task.id}" must have a description`);
    }

    const dependencies = new Set<string>();
    for (const dependency of task.depends) {
      if (dependency === task.id) {
        throw new TaskGraphValidationError(`task "${task.id}" cannot depend on itself`);
      }
      if (dependencies.has(dependency)) {
        throw new TaskGraphValidationError(`task "${task.id}" has duplicate dependency "${dependency}"`);
      }
      dependencies.add(dependency);
    }
    const writes = new Set<string>();
    const normalizedTaskWrites: string[] = [];
    for (const path of task.writes) {
      const normalized = normalizeWritePath(path);
      if (normalized === undefined) throw new TaskGraphValidationError(`task "${task.id}" has unsafe write path "${path}"`);
      if (writes.has(normalized)) throw new TaskGraphValidationError(`task "${task.id}" has duplicate write path "${path}"`);
      writes.add(normalized);
      normalizedTaskWrites.push(normalized);
    }
    normalizedWrites.set(task.id, normalizedTaskWrites);
  }

  for (const task of graph.tasks) {
    for (const dependency of task.depends) {
      if (!ids.has(dependency)) {
        throw new TaskGraphValidationError(`task "${task.id}" depends on unknown task "${dependency}"`);
      }
    }
  }

  validateCycles(graph);
  const tasks: Task[] = graph.tasks.map((task) => {
    if (!isMaestroRole(task.role)) {
      throw new TaskGraphValidationError(`task "${task.id}" has unsupported role "${task.role}"`);
    }
    return {
      ...task,
      role: task.role,
      depends: [...task.depends],
      acceptance: [...task.acceptance],
      writes: [...(normalizedWrites.get(task.id) ?? [])],
      maxAttempts: task.maxAttempts,
    };
  });

  return {
    name: graph.name,
    tasks,
  };
}
