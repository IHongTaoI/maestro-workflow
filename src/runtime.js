import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { ConfirmationRequiredError, NotFoundError, ValidationError } from "./errors.js";
import { runMemoryWorker } from "./memory-worker.js";
import { ROLE_DEFINITIONS } from "./roles.js";
import { MaestroStore } from "./store.js";
import {
  assertSafeId,
  ensureDir,
  makeId,
  requireNonEmptyString,
  requirePlainObject,
  runStamp,
} from "./util.js";

const DEFAULT_CONFIG = {
  schema_version: 1,
  models: {
    primary: null,
    memory: null,
  },
};

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function temporaryBase(id, state = "active") {
  return `memory/temporary/${state}/${assertSafeId(id, "temporary id")}`;
}

function taskBase(id) {
  return `tasks/${assertSafeId(id, "task id")}`;
}

export class MaestroRuntime {
  constructor(projectRoot, options = {}) {
    this.store = new MaestroStore(projectRoot);
    this.now = options.now ?? (() => new Date());
    this.memoryRunner = options.memoryRunner;
    this.primaryRunner = options.primaryRunner;
  }

  async init() {
    const now = this.now().toISOString();
    await this.store.initialize({ ...DEFAULT_CONFIG, created_at: now, updated_at: now });
    return { status: "initialized", root: this.store.root };
  }

  async createTemporary({ title, content = {} }) {
    requireNonEmptyString(title, "title");
    requirePlainObject(content, "content");
    await this.store.requireInitialized();
    const now = this.now();
    const id = makeId("temp", now);
    const base = temporaryBase(id);
    const timestamp = now.toISOString();
    await this.store.write(`${base}/meta.json`, {
      schema_version: 1,
      id,
      title: title.trim(),
      status: "active",
      created_at: timestamp,
      updated_at: timestamp,
    });
    await this.store.write(`${base}/current.json`, {
      title: title.trim(),
      ...content,
      history_refs: [],
    });
    return { id, status: "active", path: base };
  }

  async updateTemporary(id, patch) {
    requirePlainObject(patch, "patch");
    const base = temporaryBase(id);
    const currentFile = this.store.resolve(`${base}/current.json`);
    if (!(await exists(currentFile))) {
      throw new NotFoundError("Temporary Memory", id);
    }
    const current = await this.store.read(`${base}/current.json`);
    const meta = await this.store.read(`${base}/meta.json`);
    await this.store.write(`${base}/current.json`, { ...current, ...patch });
    await this.store.write(`${base}/meta.json`, { ...meta, updated_at: this.now().toISOString() });
    return { id, status: "updated" };
  }

  async transitionTemporary(id, destination) {
    if (!new Set(["archive", "trash"]).has(destination)) {
      throw new ValidationError("Temporary Memory destination must be archive or trash.");
    }
    const from = temporaryBase(id);
    if (!(await exists(this.store.resolve(`${from}/meta.json`)))) {
      throw new NotFoundError("Temporary Memory", id);
    }
    const meta = await this.store.read(`${from}/meta.json`);
    await this.store.write(`${from}/meta.json`, {
      ...meta,
      status: destination,
      updated_at: this.now().toISOString(),
    });
    await this.store.move(from, temporaryBase(id, destination));
    return { id, status: destination };
  }

  async runMemory(request, pendingContext) {
    const outcome = await runMemoryWorker({
      request,
      memoryRunner: this.memoryRunner,
      primaryRunner: this.primaryRunner,
    });
    if (outcome.status === "pending") {
      const pendingId = makeId("memory", this.now());
      await this.store.write(`memory/pending/${pendingId}.json`, {
        ...outcome,
        pending_id: pendingId,
        context: pendingContext,
        created_at: this.now().toISOString(),
      });
      return { ...outcome, pending_id: pendingId };
    }
    return outcome;
  }

  async applyMemoryResult(base, outcome) {
    if (outcome.status !== "completed") {
      return [];
    }
    const refs = [];
    for (const reference of outcome.result.references) {
      const referenceId = runStamp(this.now());
      const relative = `${base}/references/${referenceId}.json`;
      await this.store.write(relative, { ...reference, id: referenceId });
      refs.push(relative);
    }
    return refs;
  }

  async handoffTemporary(id) {
    const base = temporaryBase(id);
    if (!(await exists(this.store.resolve(`${base}/current.json`)))) {
      throw new NotFoundError("Temporary Memory", id);
    }
    const current = await this.store.read(`${base}/current.json`);
    const sourcePath = `${base}/current.json`;
    const request = {
      operation: "session-handoff",
      source_files: [sourcePath],
      current_memory: current,
      memory_hints: {
        remember: ["current goal", "confirmed decisions", "rejected options", "open questions"],
        forget: ["repetition", "superseded exploration", "tool narration"],
      },
      source_content: { [sourcePath]: current },
    };
    const outcome = await this.runMemory(request, { temporary_id: id });
    if (outcome.status === "completed") {
      const refs = await this.applyMemoryResult(base, outcome);
      await this.store.write(`${base}/current.json`, {
        ...outcome.result.current.content,
        history_refs: [...new Set([...(current.history_refs ?? []), ...refs])],
      });
    }
    return outcome;
  }

  async createTask({ temporaryId, objective, confirmed = false }) {
    if (!confirmed) {
      throw new ConfirmationRequiredError();
    }
    requireNonEmptyString(objective, "objective");
    const tempBase = temporaryBase(temporaryId);
    if (!(await exists(this.store.resolve(`${tempBase}/current.json`)))) {
      throw new NotFoundError("Temporary Memory", temporaryId);
    }
    const temporary = await this.store.read(`${tempBase}/current.json`);
    const tempSource = `${tempBase}/current.json`;
    const outcome = await this.runMemory(
      {
        operation: "task-bootstrap",
        source_files: [tempSource],
        current_memory: temporary,
        memory_hints: {
          remember: ["objective", "confirmed facts", "constraints", "decisions", "open questions"],
          forget: ["discussion noise", "superseded proposals"],
        },
        source_content: { [tempSource]: temporary },
      },
      { temporary_id: temporaryId },
    );
    const now = this.now();
    const id = makeId("task", now);
    const base = taskBase(id);
    const context = outcome.status === "completed" ? outcome.result.current.content : temporary;
    await Promise.all(
      ["evidence", "artifacts", "roles", "handoffs"].map((entry) =>
        ensureDir(this.store.resolve(`${base}/${entry}`)),
      ),
    );
    await this.store.write(`${base}/task.json`, {
      schema_version: 1,
      id,
      objective: objective.trim(),
      status: "active",
      source_temporary_id: temporaryId,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    await this.store.write(`${base}/context.json`, context);
    await this.store.write(`${base}/decisions.json`, { decisions: [] });
    await this.store.write(`${base}/progress.json`, { entries: [] });
    await this.applyMemoryResult(base, outcome);
    const meta = await this.store.read(`${tempBase}/meta.json`);
    await this.store.write(`${tempBase}/meta.json`, {
      ...meta,
      status: "archive",
      promoted_to_task: id,
      updated_at: this.now().toISOString(),
    });
    await this.store.move(tempBase, temporaryBase(temporaryId, "archive"));
    return { id, status: "active", path: base, memory_status: outcome.status };
  }

  async recordRoleRun({ taskId, role, result }) {
    assertSafeId(taskId, "task id");
    if (!(role in ROLE_DEFINITIONS)) {
      throw new ValidationError(`Unknown role: ${role}`);
    }
    requirePlainObject(result, "role result");
    const base = taskBase(taskId);
    if (!(await exists(this.store.resolve(`${base}/task.json`)))) {
      throw new NotFoundError("Task", taskId);
    }
    const stamp = runStamp(this.now());
    const roleBase = `${base}/roles/${role}`;
    const resultPath = `${roleBase}/runs/${stamp}-result.json`;
    await this.store.write(resultPath, result);
    const currentPath = `${roleBase}/current-state.json`;
    const current = (await exists(this.store.resolve(currentPath)))
      ? await this.store.read(currentPath)
      : {};
    const taskContext = await this.store.read(`${base}/context.json`);
    const outcome = await this.runMemory(
      {
        operation: "role-compress",
        source_files: [resultPath],
        current_memory: current,
        memory_hints: ROLE_DEFINITIONS[role],
        task_context: taskContext,
        source_content: { [resultPath]: result },
      },
      { task_id: taskId, role, result_path: resultPath },
    );
    const refs = await this.applyMemoryResult(roleBase, outcome);
    const fallbackState = result.role_state && typeof result.role_state === "object"
      ? result.role_state
      : current;
    await this.store.write(currentPath, {
      ...(outcome.status === "completed" ? outcome.result.current.content : fallbackState),
      history_refs: [...new Set([...(current.history_refs ?? []), ...refs])],
      updated_at: this.now().toISOString(),
    });
    const handoff = {
      status: result.status ?? "completed",
      summary: result.summary ?? "Role run recorded.",
      result_path: resultPath,
      role_state_path: currentPath,
      needs_user_input: Boolean(result.needs_user_input),
      recommended_next: Array.isArray(result.recommended_next) ? result.recommended_next : [],
      memory_status: outcome.status,
      created_at: this.now().toISOString(),
    };
    const handoffPath = `${base}/handoffs/${stamp}-${role}.json`;
    await this.store.write(handoffPath, handoff);
    return { ...handoff, handoff_path: handoffPath };
  }

  async readJsonFile(file) {
    return JSON.parse(await readFile(path.resolve(file), "utf8"));
  }
}
