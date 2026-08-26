import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileTaskGraph } from "./dsh/compile-workflow.ts";
import { installProjectSkill, verifyProjectSkill } from "./dsh/install-skill.ts";
import { queryProjectMemory } from "./task-memory/memory-store.ts";
import { recordTaskRun } from "./task-memory/record-run.ts";
import { prepareTaskRun, recoverTaskRunState, resumeTaskRun } from "./task-memory/task-run.ts";
import { createTask, reviseTask } from "./task-memory/task-store.ts";
import { parseTaskGraph } from "./task-graph/parse.ts";
import { validateTaskGraph } from "./task-graph/validate.ts";
import { createExecutionPlan } from "./task-graph/execution.ts";
import { initializeHost, verifyHostInstallation, type MaestroHost } from "./hosts/init.ts";
import { createWorkspace, advanceWorkspace, loadWorkspace, reviseWorkspace, setWorkspacePaused } from "./workspace/store.ts";
import type { RevisionSeverity, WorkMode, WorkspaceStage } from "./workspace/contracts.ts";
import { createTemporaryDraft, promoteWikiEntry, queryWiki, setTemporaryDraftStatus, writeCurrentMemorySummary } from "./memory/three-layer-store.ts";
import type { CurrentMemorySummary } from "./memory/contracts.ts";
import { recordTestReport, writeDeliveryReport, type TestCheck } from "./testing/gate.ts";
import {
  applyPermissions,
  collectResult,
  commitMemory,
  submitProposal,
  validateProposal,
  type ProposedEffect,
} from "./runtime/core-protocol.ts";
import { runCapabilityProbes } from "./runtime/probe-suite.ts";

export type CliIo = {
  writeStdout(message: string): void;
  writeStderr(message: string): void;
};

export type MaestroCliCommand =
  | { command: "help" }
  | { command: "init"; projectRoot: string; host: MaestroHost; force: boolean }
  | { command: "verify-host"; projectRoot: string }
  | { command: "probe-host"; projectRoot: string }
  | { command: "compile-task-graph"; filePath: string }
  | { command: "compile-execution"; filePath: string }
  | { command: "install-dsh-skill"; projectRoot: string; force: boolean }
  | { command: "verify-dsh-skill"; projectRoot: string }
  | { command: "create-task"; projectRoot: string; taskId: string; filePath: string }
  | { command: "prepare-task-run"; projectRoot: string; taskId: string; memoryQuery: string[] }
  | { command: "resume-task-run"; projectRoot: string; taskId: string }
  | { command: "recover-task"; projectRoot: string; taskId: string }
  | { command: "record-task-run"; projectRoot: string; taskId: string; filePath: string }
  | { command: "revise-task"; projectRoot: string; taskId: string; filePath: string }
  | { command: "query-memory"; projectRoot: string; query: string }
  | { command: "create-workspace"; projectRoot: string; workspaceId: string; mode: WorkMode; identity: string; filePath: string }
  | { command: "workspace-status" | "advance-workspace" | "pause-workspace" | "resume-workspace"; projectRoot: string; workspaceId: string }
  | { command: "revise-workspace"; projectRoot: string; workspaceId: string; severity: RevisionSeverity; targetStage?: WorkspaceStage; reason: string }
  | { command: "create-draft"; projectRoot: string; draftId: string; filePath: string; workspaceId?: string }
  | { command: "set-draft"; projectRoot: string; draftId: string; status: "confirmed" | "discarded" }
  | { command: "promote-wiki"; projectRoot: string; wikiId: string; title: string; filePath: string; sourceMemoryIds: string[]; tags: string[] }
  | { command: "query-wiki"; projectRoot: string; query: string }
  | { command: "write-memory-summary"; projectRoot: string; filePath: string }
  | { command: "record-tests"; projectRoot: string; workspaceId: string; filePath: string }
  | { command: "record-delivery"; projectRoot: string; workspaceId: string; filePath: string; accepted: boolean }
  | { command: "submit-proposal" | "apply-permissions"; projectRoot: string; workspaceId: string; filePath: string }
  | { command: "validate-proposal"; projectRoot: string; workspaceId: string; proposalId: string; permissionGrantId: string }
  | { command: "collect-result"; projectRoot: string; workspaceId: string; proposalId: string; filePath: string }
  | { command: "commit-memory"; projectRoot: string; workspaceId: string; resultId: string; memoryId: string; runId: string; tags: string[] };

const HELP = `Usage:
  maestro init --host dsh [--project <project-root>] [--force]
  maestro verify-host [--project <project-root>]
  maestro probe-host [--project <project-root>]
  maestro compile-task-graph --file <task-graph.yaml>
  maestro compile-execution --file <task-graph.yaml>
  maestro install-dsh-skill [--project <project-root>] [--force]
  maestro verify-dsh-skill [--project <project-root>]
  maestro create-task --task <task-id> --file <task-graph.yaml> [--project <project-root>]
  maestro prepare-task-run --task <task-id> [--memory <query>] [--project <project-root>]
  maestro resume-task-run --task <task-id> [--project <project-root>]
  maestro recover-task --task <task-id> [--project <project-root>]
  maestro record-task-run --task <task-id> --file <workflow-result.json> [--project <project-root>]
  maestro revise-task --task <task-id> --file <task-graph.yaml> [--project <project-root>]
  maestro query-memory --query <query> [--project <project-root>]
  maestro create-workspace --workspace <id> --mode <lite|plan|workflow> --identity <text> --file <request.md> [--project <root>]
  maestro workspace-status|advance-workspace|pause-workspace|resume-workspace --workspace <id> [--project <root>]
  maestro revise-workspace --workspace <id> --severity <minor|major|critical> --reason <text> [--stage <stage>] [--project <root>]
  maestro create-draft --draft <id> --file <text.md> [--workspace <id>] [--project <root>]
  maestro set-draft --draft <id> --status <confirmed|discarded> [--project <root>]
  maestro promote-wiki --wiki <id> --title <title> --file <body.md> --sources <memory-id,...> [--tags <tag,...>] [--project <root>]
  maestro query-wiki --query <query> [--project <root>]
  maestro write-memory-summary --file <summary.json> [--project <root>]
  maestro record-tests --workspace <id> --file <report.json> [--project <root>]
  maestro record-delivery --workspace <id> --file <summary.md> [--accepted] [--project <root>]
  maestro submit-proposal|apply-permissions --workspace <id> --file <input.json> [--project <root>]
  maestro validate-proposal --workspace <id> --proposal <id> --permissions <id> [--project <root>]
  maestro collect-result --workspace <id> --proposal <id> --file <result.json> [--project <root>]
  maestro commit-memory --workspace <id> --result <id> --memory <id> --run <id> --tags <tag,...> [--project <root>]

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
    command === "init" ? ["--project", "--host", "--force"]
      : command === "verify-host" || command === "probe-host" ? ["--project"]
      : command === "compile-task-graph" || command === "compile-execution" ? ["--file"]
      : command === "install-dsh-skill" ? ["--project", "--force"]
        : command === "verify-dsh-skill" ? ["--project"]
          : command === "create-task" || command === "revise-task" || command === "record-task-run"
            ? ["--project", "--task", "--file"]
            : command === "prepare-task-run" ? ["--project", "--task", "--memory"]
              : command === "resume-task-run" || command === "recover-task" ? ["--project", "--task"]
              : command === "query-memory" ? ["--project", "--query"]
                : command === "create-workspace" ? ["--project", "--workspace", "--mode", "--identity", "--file"]
                  : ["workspace-status", "advance-workspace", "pause-workspace", "resume-workspace"].includes(command) ? ["--project", "--workspace"]
                    : command === "revise-workspace" ? ["--project", "--workspace", "--severity", "--stage", "--reason"]
                      : command === "create-draft" ? ["--project", "--draft", "--file", "--workspace"]
                        : command === "set-draft" ? ["--project", "--draft", "--status"]
                          : command === "promote-wiki" ? ["--project", "--wiki", "--title", "--file", "--sources", "--tags"]
                            : command === "query-wiki" ? ["--project", "--query"]
                              : command === "write-memory-summary" ? ["--project", "--file"]
                              : command === "record-tests" ? ["--project", "--workspace", "--file"]
                                : command === "record-delivery" ? ["--project", "--workspace", "--file", "--accepted"]
                                  : command === "submit-proposal" || command === "apply-permissions" ? ["--project", "--workspace", "--file"]
                                    : command === "validate-proposal" ? ["--project", "--workspace", "--proposal", "--permissions"]
                                      : command === "collect-result" ? ["--project", "--workspace", "--proposal", "--file"]
                                        : command === "commit-memory" ? ["--project", "--workspace", "--result", "--memory", "--run", "--tags"]
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
    if (option === "--force" || option === "--accepted") {
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
  return resolve(typeof project === "string" ? project : currentDirectory);
}

/** Parses a deliberately small command surface; no command in this CLI launches DSH. */
export function parseCliArguments(args: readonly string[], currentDirectory = process.cwd()): MaestroCliCommand {
  const [command, ...options] = args;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    return { command: "help" };
  }
  if (!["init", "verify-host", "probe-host", "compile-task-graph", "compile-execution", "install-dsh-skill", "verify-dsh-skill", "create-task", "prepare-task-run", "resume-task-run", "recover-task", "record-task-run", "revise-task", "query-memory", "create-workspace", "workspace-status", "advance-workspace", "pause-workspace", "resume-workspace", "revise-workspace", "create-draft", "set-draft", "promote-wiki", "query-wiki", "write-memory-summary", "record-tests", "record-delivery", "submit-proposal", "apply-permissions", "validate-proposal", "collect-result", "commit-memory"].includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }

  const parsedOptions = parseOptions(command, options);
  if (command === "compile-task-graph" || command === "compile-execution") {
    const file = requiredOption(parsedOptions, command, "--file");
    return { command, filePath: resolve(currentDirectory, file) };
  }

  const projectRoot = projectRootFromOptions(parsedOptions, currentDirectory);
  if (command === "init") {
    const host = requiredOption(parsedOptions, command, "--host");
    if (host !== "dsh") throw new Error("init currently supports --host dsh");
    return { command, projectRoot, host, force: parsedOptions.get("--force") === true };
  }
  if (command === "verify-host") return { command, projectRoot };
  if (command === "probe-host") return { command, projectRoot };
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
  if (command === "recover-task") return { command, projectRoot, taskId: requiredOption(parsedOptions, command, "--task") };
  if (command === "query-memory") {
    return { command, projectRoot, query: requiredOption(parsedOptions, command, "--query") };
  }
  if (command === "create-workspace") {
    const mode = requiredOption(parsedOptions, command, "--mode");
    if (!(["lite", "plan", "workflow"] as string[]).includes(mode)) throw new Error("--mode must be lite, plan, or workflow");
    return {
      command,
      projectRoot,
      workspaceId: requiredOption(parsedOptions, command, "--workspace"),
      mode: mode as WorkMode,
      identity: requiredOption(parsedOptions, command, "--identity"),
      filePath: resolve(currentDirectory, requiredOption(parsedOptions, command, "--file")),
    };
  }
  if (["workspace-status", "advance-workspace", "pause-workspace", "resume-workspace"].includes(command)) {
    return { command: command as "workspace-status" | "advance-workspace" | "pause-workspace" | "resume-workspace", projectRoot, workspaceId: requiredOption(parsedOptions, command, "--workspace") };
  }
  if (command === "revise-workspace") {
    const severity = requiredOption(parsedOptions, command, "--severity");
    if (!(["minor", "major", "critical"] as string[]).includes(severity)) throw new Error("--severity must be minor, major, or critical");
    const stage = parsedOptions.get("--stage");
    return {
      command, projectRoot, workspaceId: requiredOption(parsedOptions, command, "--workspace"),
      severity: severity as RevisionSeverity, reason: requiredOption(parsedOptions, command, "--reason"),
      ...(typeof stage === "string" ? { targetStage: stage as WorkspaceStage } : {}),
    };
  }
  if (command === "create-draft") {
    const workspace = parsedOptions.get("--workspace");
    return { command, projectRoot, draftId: requiredOption(parsedOptions, command, "--draft"), filePath: resolve(currentDirectory, requiredOption(parsedOptions, command, "--file")), ...(typeof workspace === "string" ? { workspaceId: workspace } : {}) };
  }
  if (command === "set-draft") {
    const status = requiredOption(parsedOptions, command, "--status");
    if (status !== "confirmed" && status !== "discarded") throw new Error("--status must be confirmed or discarded");
    return { command, projectRoot, draftId: requiredOption(parsedOptions, command, "--draft"), status };
  }
  if (command === "promote-wiki") {
    const tags = parsedOptions.get("--tags");
    return { command, projectRoot, wikiId: requiredOption(parsedOptions, command, "--wiki"), title: requiredOption(parsedOptions, command, "--title"), filePath: resolve(currentDirectory, requiredOption(parsedOptions, command, "--file")), sourceMemoryIds: requiredOption(parsedOptions, command, "--sources").split(",").filter(Boolean), tags: typeof tags === "string" ? tags.split(",").filter(Boolean) : [] };
  }
  if (command === "query-wiki") return { command, projectRoot, query: requiredOption(parsedOptions, command, "--query") };
  if (command === "write-memory-summary") return { command, projectRoot, filePath: resolve(currentDirectory, requiredOption(parsedOptions, command, "--file")) };
  if (command === "record-tests") return { command, projectRoot, workspaceId: requiredOption(parsedOptions, command, "--workspace"), filePath: resolve(currentDirectory, requiredOption(parsedOptions, command, "--file")) };
  if (command === "record-delivery") return { command, projectRoot, workspaceId: requiredOption(parsedOptions, command, "--workspace"), filePath: resolve(currentDirectory, requiredOption(parsedOptions, command, "--file")), accepted: parsedOptions.get("--accepted") === true };
  if (command === "submit-proposal" || command === "apply-permissions") return { command, projectRoot, workspaceId: requiredOption(parsedOptions, command, "--workspace"), filePath: resolve(currentDirectory, requiredOption(parsedOptions, command, "--file")) };
  if (command === "validate-proposal") return { command, projectRoot, workspaceId: requiredOption(parsedOptions, command, "--workspace"), proposalId: requiredOption(parsedOptions, command, "--proposal"), permissionGrantId: requiredOption(parsedOptions, command, "--permissions") };
  if (command === "collect-result") return { command, projectRoot, workspaceId: requiredOption(parsedOptions, command, "--workspace"), proposalId: requiredOption(parsedOptions, command, "--proposal"), filePath: resolve(currentDirectory, requiredOption(parsedOptions, command, "--file")) };
  if (command === "commit-memory") return { command, projectRoot, workspaceId: requiredOption(parsedOptions, command, "--workspace"), resultId: requiredOption(parsedOptions, command, "--result"), memoryId: requiredOption(parsedOptions, command, "--memory"), runId: requiredOption(parsedOptions, command, "--run"), tags: requiredOption(parsedOptions, command, "--tags").split(",").filter(Boolean) };
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
    if (command.command === "init") {
      writeJson(io, await initializeHost({ projectRoot: command.projectRoot, host: command.host, sourceSkillRoot: bundledSkillRoot(), ...(command.force ? { force: true } : {}) }));
      return 0;
    }
    if (command.command === "verify-host") {
      const result = await verifyHostInstallation({ projectRoot: command.projectRoot, sourceSkillRoot: bundledSkillRoot() });
      writeJson(io, result);
      return result.status === "installed" && result.runtimeConfigured ? 0 : 1;
    }
    if (command.command === "probe-host") {
      const result = await runCapabilityProbes({ sourceSkillRoot: bundledSkillRoot() });
      writeJson(io, result);
      return result.status === "passed" ? 0 : 1;
    }
    if (command.command === "compile-task-graph") {
      const source = await readFile(command.filePath, "utf8");
      writeJson(io, compileTaskGraph(validateTaskGraph(parseTaskGraph(source))));
      return 0;
    }
    if (command.command === "compile-execution") {
      const source = await readFile(command.filePath, "utf8");
      writeJson(io, createExecutionPlan(validateTaskGraph(parseTaskGraph(source))));
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
    if (command.command === "recover-task") {
      writeJson(io, await recoverTaskRunState({ projectRoot: command.projectRoot, taskId: command.taskId }));
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

    if (command.command === "create-workspace") {
      writeJson(io, await createWorkspace({ projectRoot: command.projectRoot, workspaceId: command.workspaceId, identity: command.identity, mode: command.mode, request: await readFile(command.filePath, "utf8") }));
      return 0;
    }
    if (command.command === "workspace-status") {
      writeJson(io, await loadWorkspace(command.projectRoot, command.workspaceId));
      return 0;
    }
    if (command.command === "advance-workspace") {
      writeJson(io, await advanceWorkspace({ projectRoot: command.projectRoot, workspaceId: command.workspaceId }));
      return 0;
    }
    if (command.command === "pause-workspace" || command.command === "resume-workspace") {
      writeJson(io, await setWorkspacePaused(command.projectRoot, command.workspaceId, command.command === "pause-workspace"));
      return 0;
    }
    if (command.command === "revise-workspace") {
      writeJson(io, await reviseWorkspace({ projectRoot: command.projectRoot, workspaceId: command.workspaceId, severity: command.severity, reason: command.reason, ...(command.targetStage === undefined ? {} : { targetStage: command.targetStage }) }));
      return 0;
    }
    if (command.command === "create-draft") {
      writeJson(io, await createTemporaryDraft({ projectRoot: command.projectRoot, id: command.draftId, text: await readFile(command.filePath, "utf8"), ...(command.workspaceId === undefined ? {} : { workspaceId: command.workspaceId }) }));
      return 0;
    }
    if (command.command === "set-draft") {
      writeJson(io, await setTemporaryDraftStatus({ projectRoot: command.projectRoot, id: command.draftId, status: command.status }));
      return 0;
    }
    if (command.command === "promote-wiki") {
      writeJson(io, await promoteWikiEntry({ projectRoot: command.projectRoot, id: command.wikiId, title: command.title, body: await readFile(command.filePath, "utf8"), tags: command.tags, sourceMemoryIds: command.sourceMemoryIds }));
      return 0;
    }
    if (command.command === "query-wiki") {
      writeJson(io, await queryWiki(command.projectRoot, [command.query]));
      return 0;
    }
    if (command.command === "write-memory-summary") {
      const input = JSON.parse(await readFile(command.filePath, "utf8")) as Omit<CurrentMemorySummary, "schemaVersion" | "sourceHash">;
      writeJson(io, await writeCurrentMemorySummary({ projectRoot: command.projectRoot, summary: input }));
      return 0;
    }
    if (command.command === "record-tests") {
      const input = JSON.parse(await readFile(command.filePath, "utf8")) as { checks: TestCheck[]; userFeedback?: string };
      writeJson(io, await recordTestReport({ projectRoot: command.projectRoot, workspaceId: command.workspaceId, checks: input.checks, ...(input.userFeedback === undefined ? {} : { userFeedback: input.userFeedback }) }));
      return 0;
    }
    if (command.command === "record-delivery") {
      const report = await writeDeliveryReport({ projectRoot: command.projectRoot, workspaceId: command.workspaceId, summary: await readFile(command.filePath, "utf8"), accepted: command.accepted });
      writeJson(io, { status: command.accepted ? "accepted" : "rejected", report });
      return 0;
    }
    if (command.command === "submit-proposal") {
      const input = JSON.parse(await readFile(command.filePath, "utf8")) as { taskId: string; role: string; summary: string; effects: ProposedEffect[]; expectedOutputs: string[]; id?: string };
      writeJson(io, await submitProposal({ projectRoot: command.projectRoot, workspaceId: command.workspaceId, ...input }));
      return 0;
    }
    if (command.command === "apply-permissions") {
      const input = JSON.parse(await readFile(command.filePath, "utf8")) as { role: string; read?: string[]; write?: string[]; execute?: string[]; id?: string };
      writeJson(io, await applyPermissions({ projectRoot: command.projectRoot, workspaceId: command.workspaceId, ...input }));
      return 0;
    }
    if (command.command === "validate-proposal") {
      writeJson(io, await validateProposal({ projectRoot: command.projectRoot, workspaceId: command.workspaceId, proposalId: command.proposalId, permissionGrantId: command.permissionGrantId }));
      return 0;
    }
    if (command.command === "collect-result") {
      const input = JSON.parse(await readFile(command.filePath, "utf8")) as { summary: string; artifactPaths: string[]; blockers?: string[] };
      writeJson(io, await collectResult({ projectRoot: command.projectRoot, workspaceId: command.workspaceId, proposalId: command.proposalId, ...input }));
      return 0;
    }
    if (command.command === "commit-memory") {
      writeJson(io, await commitMemory({ projectRoot: command.projectRoot, workspaceId: command.workspaceId, resultId: command.resultId, memoryId: command.memoryId, runId: command.runId, tags: command.tags }));
      return 0;
    }

    if (command.command === "query-memory") {
      writeJson(io, await queryProjectMemory({ projectRoot: command.projectRoot, queries: [command.query] }));
      return 0;
    }
    throw new Error(`unhandled command: ${command.command}`);
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
