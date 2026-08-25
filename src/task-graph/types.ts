export const MAESTRO_ROLES = ["tpm", "architect", "planner", "coder", "tester"] as const;

export type MaestroRole = (typeof MAESTRO_ROLES)[number];

export interface ParsedTask {
  id: string;
  role: string;
  description: string;
  depends: string[];
  acceptance: string[];
}

export interface ParsedTaskGraph {
  name: string;
  tasks: ParsedTask[];
}

export interface Task extends Omit<ParsedTask, "role"> {
  role: MaestroRole;
}

export interface TaskGraph {
  name: string;
  tasks: Task[];
}

export function isMaestroRole(value: string): value is MaestroRole {
  return (MAESTRO_ROLES as readonly string[]).includes(value);
}
