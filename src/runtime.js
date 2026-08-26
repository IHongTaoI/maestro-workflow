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

function archivedTaskBase(id) {
  return `tasks/archive/${assertSafeId(id, "task id")}`;
}

function candidateBase(state, id) {
  if (!new Set(["pending", "approved", "rejected"]).has(state)) {
    throw new ValidationError("Candidate state must be pending, approved or rejected.");
  }
  return `memory/long-term/candidates/${state}/${assertSafeId(id, "candidate id")}.json`;
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

  async persistLongTermCandidates(outcome, context = {}, sourceRefMap = {}) {
    if (outcome.status !== "completed") {
      return [];
    }
    const persisted = [];
    for (const candidate of outcome.result.long_term_candidates) {
      const id = makeId("candidate", this.now());
      const record = {
        ...candidate,
        id,
        status: "pending",
        source_refs: candidate.source_refs.map((source) => sourceRefMap[source] ?? source),
        context,
        created_at: this.now().toISOString(),
      };
      await this.store.write(candidateBase("pending", id), record);
      persisted.push(record);
    }
    return persisted;
  }

  async remapPendingSources(outcome, sourceRefMap) {
    if (outcome.status !== "pending" || !outcome.pending_id) {
      return;
    }
    const relative = `memory/pending/${outcome.pending_id}.json`;
    const pending = await this.store.read(relative);
    const request = pending.request ?? {};
    const sourceContent = request.source_content ?? {};
    await this.store.write(relative, {
      ...pending,
      request: {
        ...request,
        source_files: (request.source_files ?? []).map(
          (source) => sourceRefMap[source] ?? source,
        ),
        source_content: Object.fromEntries(
          Object.entries(sourceContent).map(([source, content]) => [
            sourceRefMap[source] ?? source,
            content,
          ]),
        ),
      },
    });
  }

  async listLongTermCandidates(state = "pending") {
    candidateBase(state, "candidate-placeholder");
    const entries = await this.store.list(`memory/long-term/candidates/${state}`);
    const candidates = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => this.store.read(`memory/long-term/candidates/${state}/${entry.name}`)),
    );
    return candidates.sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  async reviewLongTermCandidate({ candidateId, approved, reviewer, rationale = "" }) {
    assertSafeId(candidateId, "candidate id");
    if (typeof approved !== "boolean") {
      throw new ValidationError("approved must be an explicit boolean.");
    }
    requireNonEmptyString(reviewer, "reviewer");
    const pendingPath = candidateBase("pending", candidateId);
    if (!(await exists(this.store.resolve(pendingPath)))) {
      throw new NotFoundError("Long-term candidate", candidateId);
    }
    const candidate = await this.store.read(pendingPath);
    const now = this.now().toISOString();
    const status = approved ? "approved" : "rejected";
    const review = {
      approved,
      reviewer: reviewer.trim(),
      rationale: typeof rationale === "string" ? rationale.trim() : "",
      reviewed_at: now,
    };
    const reviewed = { ...candidate, status, review };

    if (approved) {
      const current = await this.store.read("memory/long-term/current.json");
      await this.store.write("memory/long-term/current.json", {
        ...current,
        entries: [
          ...(Array.isArray(current.entries) ? current.entries : []),
          {
            candidate_id: candidateId,
            title: candidate.title,
            content: candidate.content,
            source_refs: candidate.source_refs,
            review,
            promoted_at: now,
          },
        ],
        updated_at: now,
      });
    }

    await this.store.write(`memory/long-term/decisions/${candidateId}.json`, reviewed);
    await this.store.write(candidateBase(status, candidateId), reviewed);
    await this.store.remove(pendingPath);
    return reviewed;
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
    await this.store.write(`${base}/decisions.json`, { decisions: [] });
    await this.store.write(`${base}/progress.json`, { entries: [] });
    const refs = await this.applyMemoryResult(base, outcome);
    await this.store.write(`${base}/context.json`, {
      ...context,
      history_refs: [...new Set([...(context.history_refs ?? []), ...refs])],
    });
    const meta = await this.store.read(`${tempBase}/meta.json`);
    await this.store.write(`${tempBase}/meta.json`, {
      ...meta,
      status: "archive",
      promoted_to_task: id,
      updated_at: this.now().toISOString(),
    });
    await this.store.move(tempBase, temporaryBase(temporaryId, "archive"));
    const sourceRefMap = { [tempSource]: `${temporaryBase(temporaryId, "archive")}/current.json` };
    await this.remapPendingSources(outcome, sourceRefMap);
    const candidates = await this.persistLongTermCandidates(
      outcome,
      { task_id: id, operation: "task-bootstrap" },
      sourceRefMap,
    );
    return {
      id,
      status: "active",
      path: base,
      memory_status: outcome.status,
      memory_pending_id: outcome.pending_id ?? null,
      candidate_ids: candidates.map((candidate) => candidate.id),
    };
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
      memory_pending_id: outcome.pending_id ?? null,
      created_at: this.now().toISOString(),
    };
    const handoffPath = `${base}/handoffs/${stamp}-${role}.json`;
    await this.store.write(handoffPath, handoff);
    const candidates = await this.persistLongTermCandidates(outcome, {
      task_id: taskId,
      role,
      operation: "role-compress",
    });
    return {
      ...handoff,
      handoff_path: handoffPath,
      candidate_ids: candidates.map((candidate) => candidate.id),
    };
  }

  async completeTask({ taskId, summary }) {
    requireNonEmptyString(summary, "summary");
    const base = taskBase(taskId);
    if (!(await exists(this.store.resolve(`${base}/task.json`)))) {
      throw new NotFoundError("Active Task", taskId);
    }
    const task = await this.store.read(`${base}/task.json`);
    const context = await this.store.read(`${base}/context.json`);
    const decisions = await this.store.read(`${base}/decisions.json`);
    const progress = await this.store.read(`${base}/progress.json`);
    const sourceFiles = [
      `${base}/task.json`,
      `${base}/context.json`,
      `${base}/decisions.json`,
      `${base}/progress.json`,
    ];
    const sourceContent = {
      [sourceFiles[0]]: task,
      [sourceFiles[1]]: context,
      [sourceFiles[2]]: decisions,
      [sourceFiles[3]]: progress,
    };
    const outcome = await this.runMemory(
      {
        operation: "task-complete",
        source_files: sourceFiles,
        current_memory: { summary: summary.trim(), context, decisions, progress },
        memory_hints: {
          remember: ["outcome", "stable decisions", "verified facts", "remaining limitations"],
          forget: ["superseded task detail", "execution narration"],
        },
        task_context: context,
        source_content: sourceContent,
      },
      { task_id: taskId, operation: "task-complete" },
    );
    const now = this.now().toISOString();
    const refs = await this.applyMemoryResult(base, outcome);
    await this.store.write(`${base}/completion.json`, {
      schema_version: 1,
      task_id: taskId,
      summary: summary.trim(),
      memory_status: outcome.status,
      final_memory: outcome.status === "completed" ? outcome.result.current.content : null,
      history_refs: refs,
      completed_at: now,
    });
    await this.store.write(`${base}/task.json`, { ...task, status: "completed", updated_at: now });
    const archiveBase = archivedTaskBase(taskId);
    await this.store.move(base, archiveBase);
    const sourceRefMap = Object.fromEntries(
      sourceFiles.map((source) => [source, source.replace(`${base}/`, `${archiveBase}/`)]),
    );
    await this.remapPendingSources(outcome, sourceRefMap);
    const candidates = await this.persistLongTermCandidates(
      outcome,
      { task_id: taskId, operation: "task-complete" },
      sourceRefMap,
    );
    return {
      id: taskId,
      status: "completed",
      path: archiveBase,
      memory_status: outcome.status,
      memory_pending_id: outcome.pending_id ?? null,
      candidate_ids: candidates.map((candidate) => candidate.id),
    };
  }

  async listPlaybooks() {
    const entries = await this.store.list("playbooks");
    return entries
      .filter((entry) => entry.isFile() && /\.(?:json|md)$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  async readPlaybook(name) {
    assertSafeId(name, "playbook name");
    if (!/\.(?:json|md)$/i.test(name)) {
      throw new ValidationError("Playbooks must use .json or .md files.");
    }
    const relative = `playbooks/${name}`;
    if (!(await exists(this.store.resolve(relative)))) {
      throw new NotFoundError("Playbook", name);
    }
    const raw = await this.store.readText(relative);
    return {
      name,
      format: name.toLowerCase().endsWith(".json") ? "json" : "markdown",
      content: name.toLowerCase().endsWith(".json") ? JSON.parse(raw) : raw,
    };
  }

  async readJsonFile(file) {
    return JSON.parse(await readFile(path.resolve(file), "utf8"));
  }
}
