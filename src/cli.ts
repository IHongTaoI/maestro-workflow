import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileTaskGraph } from "./dsh/compile-workflow.ts";
import { installProjectSkill, verifyProjectSkill } from "./dsh/install-skill.ts";
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
  | { command: "verify-dsh-skill"; projectRoot: string };

const HELP = `Usage:
  maestro compile-task-graph --file <task-graph.yaml>
  maestro install-dsh-skill [--project <project-root>] [--force]
  maestro verify-dsh-skill [--project <project-root>]

compile-task-graph prints a fixed DSH workflow request. It does not invoke DSH or a model.
install-dsh-skill copies the bundled Skill to <project>/.dsh/skills/maestro-workflow.
verify-dsh-skill exits 1 when that installed copy is missing or modified.
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

/** Parses a deliberately small command surface; no command in this CLI launches DSH. */
export function parseCliArguments(args: readonly string[], currentDirectory = process.cwd()): MaestroCliCommand {
  const [command, ...options] = args;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    return { command: "help" };
  }
  if (command !== "compile-task-graph" && command !== "install-dsh-skill" && command !== "verify-dsh-skill") {
    throw new Error(`unknown command: ${command}`);
  }

  const parsedOptions = parseOptions(command, options);
  if (command === "compile-task-graph") {
    const file = parsedOptions.get("--file");
    if (typeof file !== "string") throw new Error("compile-task-graph requires --file <task-graph.yaml>");
    return { command, filePath: resolve(currentDirectory, file) };
  }

  const project = parsedOptions.get("--project");
  const projectRoot = resolve(currentDirectory, typeof project === "string" ? project : currentDirectory);
  if (command === "install-dsh-skill") {
    return { command, projectRoot, force: parsedOptions.get("--force") === true };
  }
  return { command, projectRoot };
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

    const result = await verifyProjectSkill({
      projectRoot: command.projectRoot,
      sourceSkillRoot: bundledSkillRoot(),
    });
    writeJson(io, result);
    return result.status === "installed" ? 0 : 1;
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
