import { readFile } from "node:fs/promises";
import path from "node:path";

import { ValidationError } from "./errors.js";
import { MaestroRuntime } from "./runtime.js";

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const options = {};
  const booleanOptions = new Set(["approve", "confirmed", "help", "reject"]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      throw new ValidationError(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    if (booleanOptions.has(key)) {
      options[key] = true;
      continue;
    }
    const next = tokens[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return { command, options };
}

async function loadJson(file, label) {
  if (!file) {
    return {};
  }
  try {
    return JSON.parse(await readFile(path.resolve(file), "utf8"));
  } catch (error) {
    throw new ValidationError(`Cannot read ${label}: ${error.message}`);
  }
}

function usage() {
  return `Maestro v1

Commands:
  init --root <project>
  temp-create --root <project> --title <text> [--file <json>]
  temp-update --root <project> --id <temporary-id> --file <json>
  temp-archive --root <project> --id <temporary-id>
  temp-trash --root <project> --id <temporary-id>
  session-handoff --root <project> --id <temporary-id> [--memory-response <json>]
  task-create --root <project> --temp <temporary-id> --objective <text> --confirmed [--memory-response <json>]
  role-record --root <project> --task <task-id> --role <role> --file <json> [--memory-response <json>]
  task-complete --root <project> --task <task-id> --summary <text> [--memory-response <json>]
  memory-candidates --root <project> [--state pending|approved|rejected]
  memory-review --root <project> --id <candidate-id> --reviewer <name> (--approve|--reject) [--rationale <text>]
  playbook-list --root <project>
  playbook-read --root <project> --name <file.json|file.md>
`;
}

export async function runCli(argv, io = process) {
  const { command, options } = parseArgs(argv);
  if (!command || command === "help" || options.help) {
    io.stdout.write(usage());
    return;
  }
  const root = path.resolve(options.root || process.cwd());
  const memoryResponse = options["memory-response"]
    ? await loadJson(options["memory-response"], "Memory Worker response")
    : null;
  const runtime = new MaestroRuntime(root, {
    memoryRunner: memoryResponse ? async () => memoryResponse : undefined,
  });
  let result;
  switch (command) {
    case "init":
      result = await runtime.init();
      break;
    case "temp-create":
      result = await runtime.createTemporary({
        title: options.title,
        content: await loadJson(options.file, "temporary content"),
      });
      break;
    case "temp-update":
      result = await runtime.updateTemporary(options.id, await loadJson(options.file, "temporary patch"));
      break;
    case "temp-archive":
      result = await runtime.transitionTemporary(options.id, "archive");
      break;
    case "temp-trash":
      result = await runtime.transitionTemporary(options.id, "trash");
      break;
    case "session-handoff":
      result = await runtime.handoffTemporary(options.id);
      break;
    case "task-create":
      result = await runtime.createTask({
        temporaryId: options.temp,
        objective: options.objective,
        confirmed: options.confirmed === true,
      });
      break;
    case "role-record":
      result = await runtime.recordRoleRun({
        taskId: options.task,
        role: options.role,
        result: await loadJson(options.file, "role result"),
      });
      break;
    case "task-complete":
      result = await runtime.completeTask({ taskId: options.task, summary: options.summary });
      break;
    case "memory-candidates":
      result = await runtime.listLongTermCandidates(options.state ?? "pending");
      break;
    case "memory-review":
      if (Boolean(options.approve) === Boolean(options.reject)) {
        throw new ValidationError("Choose exactly one of --approve or --reject.");
      }
      result = await runtime.reviewLongTermCandidate({
        candidateId: options.id,
        approved: Boolean(options.approve),
        reviewer: options.reviewer,
        rationale: options.rationale,
      });
      break;
    case "playbook-list":
      result = await runtime.listPlaybooks();
      break;
    case "playbook-read":
      result = await runtime.readPlaybook(options.name);
      break;
    default:
      throw new ValidationError(`Unknown command: ${command}`);
  }
  io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
