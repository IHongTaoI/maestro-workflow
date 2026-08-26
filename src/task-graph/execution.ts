import { dependencyLayers } from "../dsh/compile-workflow.ts";
import type { TaskGraph } from "./types.ts";

export type ExecutionPlan = {
  schemaVersion: 1;
  graph: string;
  frozenGraphDigest?: string;
  layers: Array<{
    id: string;
    tasks: Array<{
      id: string;
      role: string;
      status: "pending";
      attempts: 0;
      maxAttempts: number;
      writes: string[];
    }>;
  }>;
};

/** Builds a deterministic execution ledger; conflicting write sets never share a layer. */
export function createExecutionPlan(graph: TaskGraph): ExecutionPlan {
  return {
    schemaVersion: 1,
    graph: graph.name,
    layers: dependencyLayers(graph).map((layer) => ({
      id: layer.phase,
      tasks: layer.tasks.map((task) => ({
        id: task.id,
        role: task.role,
        status: "pending",
        attempts: 0,
        maxAttempts: task.maxAttempts,
        writes: [...task.writes],
      })),
    })),
  };
}
