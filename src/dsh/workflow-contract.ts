import type { MaestroRole } from "../task-graph/types.ts";
import type { PersistedTaskContext } from "../task-memory/contracts.ts";

export interface DshWorkflowPhase {
  title: string;
  detail?: string;
}

export interface DshWorkflowMeta {
  name: string;
  description: string;
  whenToUse: string;
  phases: DshWorkflowPhase[];
}

export interface CompiledTask {
  id: string;
  role: MaestroRole;
  description: string;
  depends: string[];
  acceptance: string[];
  writes: string[];
  maxAttempts: number;
}

export interface CompiledLayer {
  phase: string;
  tasks: CompiledTask[];
}

export const TASK_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "artifacts", "blockers"],
  properties: {
    summary: { type: "string" },
    artifacts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "description"],
        properties: {
          path: { type: "string" },
          description: { type: "string" },
        },
      },
    },
    blockers: {
      type: "array",
      items: { type: "string" },
    },
    needsUserInput: {
      type: "object",
      additionalProperties: false,
      required: ["question", "context"],
      properties: {
        question: { type: "string" },
        context: { type: "string" },
      },
    },
    needsDelegation: {
      type: "object",
      additionalProperties: false,
      required: ["role", "task"],
      properties: {
        role: { type: "string" },
        task: { type: "string" },
      },
    },
    roleState: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "decisions", "blockers", "nextActions"],
      properties: {
        summary: { type: "string" },
        decisions: { type: "array", items: { type: "string" } },
        blockers: { type: "array", items: { type: "string" } },
        nextActions: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

export interface CompiledWorkflowArgs {
  graphName: string;
  layers: CompiledLayer[];
  resultSchema: typeof TASK_RESULT_SCHEMA;
  taskContext?: PersistedTaskContext;
}

/** The model-facing subset of DSH's workflow tool input. */
export interface DshWorkflowRequest {
  script: string;
  meta: DshWorkflowMeta;
  args: CompiledWorkflowArgs;
}
