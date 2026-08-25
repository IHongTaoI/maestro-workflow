import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileTaskGraph } from "./dsh/compile-workflow.ts";
import { installProjectSkill, verifyProjectSkill } from "./dsh/install-skill.ts";
import { queryProjectMemory } from "./task-memory/memory-store.ts";
import { recordTaskRun } from "./task-memory/record-run.ts";
import { prepareTaskRun, resumeTaskRun } from "./task-memory/task-run.ts";
import { createTask, reviseTask } from "./task-memory/task-store.ts";
import { parseTaskGraph } from "./task-graph/parse.ts";
import { validateTaskGraph } from "./task-graph/validate.ts";

export type CliIo = {
  writeStdout(message: string): void;
  writeStderr(message: string): void;
};

export type MaestroCliCommand =
  | { command: "help" }
  | { command: "compile-task-graph"; filePath: string }
  | { command: "install-dsh-skill"; projectRoot: string; force: boolean }
  | { command: "verify-dsh-skill"; projectRoot: string }
  | { command: "create-task"; projectRoot: string; taskId: string; filePath: string }
  | { command: "prepare-task-run"; projectRoot: string; taskId: string; memoryQuery: string[] }
  | { command: "resume-task-run"; projectRoot: string; taskId: string }
  | { command: "record-task-run"; projectRoot: string; taskId: string; filePath: string }
  | { command: "revise-task"; projectRoot: string; taskId: string; filePath: string }
  | { command: "query-memory"; projectRoot: string; query: string };

const HELP = `Usage:
  maestro compile-task-graph --file <task-graph.yaml>
  maestro install-dsh-skill [--project <project-root>] [--force]
  maestro verify-dsh-skill [--project <project-root>]
  maestro create-task --task <task-id> --file <task-graph.yaml> [--project <project-root>]
  maestro prepare-task-run --task <task-id> [--memory <query>] [--project <project-root>]
  maestro resume-task-run --task <task-id> [--project <project-root>]
  maestro record-task-run --task <task-id> --file <workflow-result.json> [--project <project-root>]
  maestro revise-task --task <task-id> --file <task-graph.yaml> [--project <project-root>]
  maestro query-memory --query <query> [--project <project-root>]

compile-task-graph prints a fixed DSH workflow request. It does not invoke DSH or a model.
install-dsh-skill copies the bundled Skill to <project>/.dsh/skills/maestro-workflow.
verify-dsh-skill exits 1 when that installed copy is missing or modified.
Task commands read and write .maestro project state but never invoke DSH or a model.
`;

function requireOptionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--") || value.trim() === "") {
    throw new Error(`${option} requires a non-empty value`);
  }
  return value;
}

function parseOptions(command: string, args: readonly string[]): Map<string, string | true> {
  const supported = new Set(
    command === "compile-task-graph" ? ["--file"]
      : command === "install-dsh-skill" ? ["--project", "--force"]
        : command === "verify-dsh-skill" ? ["--project"]
          : command === "create-task" || command === "revise-task" || command === "record-task-run"
            ? ["--project", "--task", "--file"]
            : command === "prepare-task-run" ? ["--project", "--task", "--memory"]
              : command === "resume-task-run" ? ["--project", "--task"]
              : command === "query-memory" ? ["--project", "--query"]
                : [],
  );
  const values = new Map<string, string | true>();

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === undefined || !option.startsWith("--")) {
      throw new Error(`unexpected argument for ${command}: ${option ?? ""}`.trim());
    }
    if (!supported.has(option)) {
      throw new Error(`${command} does not support ${option}`);
    }
    if (values.has(option)) {
      throw new Error(`${option} may be specified only once`);
    }
    if (option === "--force") {
      values.set(option, true);
      continue;
    }
    const value = requireOptionValue(args, index, option);
    values.set(option, value);
    index += 1;
  }
  return values;
}

function requiredOption(options: Map<string, string | true>, command: string, option: string): string {
  const value = options.get(option);
  if (typeof value !== "string") throw new Error(`${command} requires ${option} <value>`);
  return value;
}

function projectRootFromOptions(options: Map<string, string | true>, currentDirectory: string): string {
  const project = options.get("--project");
  return resolve(currentDirectory, typeof project === "string" ? project : currentDirectory);
}

/** Parses a deliberately small command surface; no command in this CLI launches DSH. */
export function parseCliArguments(args: readonly string[], currentDirectory = process.cwd()): MaestroCliCommand {
  const [command, ...options] = args;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    return { command: "help" };
  }
  if (!["compile-task-graph", "install-dsh-skill", "verify-dsh-skill", "create-task", "prepare-task-run", "resume-task-run", "record-task-run", "revise-task", "query-memory"].includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }

  const parsedOptions = parseOptions(command, options);
  if (command === "compile-task-graph") {
    const file = requiredOption(parsedOptions, command, "--file");
    return { command, filePath: resolve(currentDirectory, file) };
  }

  const projectRoot = projectRootFromOptions(parsedOptions, currentDirectory);
  if (command === "install-dsh-skill") {
    return { command, projectRoot, force: parsedOptions.get("--force") === true };
  }
  if (command === "verify-dsh-skill") return { command, projectRoot };
  if (command === "prepare-task-run") {
    const memory = parsedOptions.get("--memory");
    return {
      command,
      projectRoot,
      taskId: requiredOption(parsedOptions, command, "--task"),
      memoryQuery: typeof memory === "string" ? [memory] : [],
    };
  }
  if (command === "resume-task-run") {
    return {
      command,
      projectRoot,
      taskId: requiredOption(parsedOptions, command, "--task"),
    };
  }
  if (command === "query-memory") {
    return { command, projectRoot, query: requiredOption(parsedOptions, command, "--query") };
  }
  if (command === "create-task" || command === "record-task-run" || command === "revise-task") {
    return {
      command,
      projectRoot,
      taskId: requiredOption(parsedOptions, command, "--task"),
      filePath: resolve(currentDirectory, requiredOption(parsedOptions, command, "--file")),
    };
  }
  throw new Error(`unknown command: ${command}`);
}

function bundledSkillRoot(): string {
  const packageRoot = fileURLToPath(new URL("../", import.meta.url));
  return resolve(packageRoot, "skills", "maestro-workflow");
}

function writeJson(io: CliIo, value: unknown): void {
  io.writeStdout(`${JSON.stringify(value, null, 2)}\n`);
}

/** Executes a local preparation command, never a DSH workflow or child Agent. */
export async function runCli(args: readonly string[], io: CliIo, currentDirectory = process.cwd()): Promise<number> {
  try {
    const command = parseCliArguments(args, currentDirectory);
    if (command.command === "help") {
      io.writeStdout(HELP);
      return 0;
    }
    if (command.command === "compile-task-graph") {
      const source = await readFile(command.filePath, "utf8");
      writeJson(io, compileTaskGraph(validateTaskGraph(parseTaskGraph(source))));
      return 0;
    }
    if (command.command === "install-dsh-skill") {
      const result = await installProjectSkill({
        projectRoot: command.projectRoot,
        sourceSkillRoot: bundledSkillRoot(),
        ...(command.force ? { force: true } : {}),
      });
      writeJson(io, result);
      return 0;
    }
    if (command.command === "verify-dsh-skill") {
      const result = await verifyProjectSkill({
        projectRoot: command.projectRoot,
        sourceSkillRoot: bundledSkillRoot(),
      });
      writeJson(io, result);
      return result.status === "installed" ? 0 : 1;
    }
    if (command.command === "create-task" || command.command === "revise-task") {
      const graph = validateTaskGraph(parseTaskGraph(await readFile(command.filePath, "utf8")));
      const result = command.command === "create-task"
        ? await createTask({ projectRoot: command.projectRoot, taskId: command.taskId, graph })
        : await reviseTask({ projectRoot: command.projectRoot, taskId: command.taskId, graph });
      writeJson(io, result);
      return 0;
    }
    if (command.command === "prepare-task-run") {
      const result = await prepareTaskRun({
        projectRoot: command.projectRoot,
        taskId: command.taskId,
        memoryQuery: command.memoryQuery,
      });
      writeJson(io, result.workflow);
      return 0;
    }
    if (command.command === "resume-task-run") {
      const result = await resumeTaskRun({ projectRoot: command.projectRoot, taskId: command.taskId });
      writeJson(io, result.workflow);
      return 0;
    }
    if (command.command === "record-task-run") {
      const result = await recordTaskRun({
        projectRoot: command.projectRoot,
        taskId: command.taskId,
        result: JSON.parse(await readFile(command.filePath, "utf8")) as unknown,
      });
      writeJson(io, result);
      return 0;
    }

    writeJson(io, await queryProjectMemory({ projectRoot: command.projectRoot, queries: [command.query] }));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.writeStderr(`maestro: ${message}\n`);
    return 1;
  }
}

async function main(): Promise<void> {
  const exitCode = await runCli(process.argv.slice(2), {
    writeStdout: (message) => process.stdout.write(message),
    writeStderr: (message) => process.stderr.write(message),
  });
  process.exitCode = exitCode;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) {
  void main();
}
