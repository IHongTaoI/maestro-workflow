import { access, mkdir, rename } from "node:fs/promises";
import path from "node:path";

import { NotInitializedError, ValidationError } from "./errors.js";
import { atomicWriteJson, ensureDir, readJson } from "./util.js";

const INITIAL_DIRECTORIES = [
  "memory/long-term/decisions",
  "memory/temporary/active",
  "memory/temporary/archive",
  "memory/temporary/trash",
  "memory/pending",
  "tasks",
  "playbooks",
];

export class MaestroStore {
  constructor(projectRoot) {
    this.projectRoot = path.resolve(projectRoot);
    this.root = path.join(this.projectRoot, ".maestro");
  }

  resolve(relativePath = ".") {
    if (path.isAbsolute(relativePath)) {
      throw new ValidationError("Store paths must be relative.");
    }
    const resolved = path.resolve(this.root, relativePath);
    const boundary = `${this.root}${path.sep}`;
    if (resolved !== this.root && !resolved.startsWith(boundary)) {
      throw new ValidationError(`Path escapes .maestro: ${relativePath}`);
    }
    return resolved;
  }

  async initialize(config) {
    await mkdir(this.root, { recursive: true });
    await Promise.all(INITIAL_DIRECTORIES.map((entry) => ensureDir(this.resolve(entry))));
    await atomicWriteJson(this.resolve("config.json"), config);
    const longTerm = this.resolve("memory/long-term/current.json");
    try {
      await access(longTerm);
    } catch {
      await atomicWriteJson(longTerm, {
        schema_version: 1,
        facts: [],
        updated_at: config.created_at,
      });
    }
  }

  async requireInitialized() {
    try {
      await access(this.resolve("config.json"));
    } catch {
      throw new NotInitializedError(this.projectRoot);
    }
  }

  async read(relativePath) {
    await this.requireInitialized();
    return readJson(this.resolve(relativePath));
  }

  async write(relativePath, value) {
    await this.requireInitialized();
    await atomicWriteJson(this.resolve(relativePath), value);
  }

  async move(fromRelative, toRelative) {
    await this.requireInitialized();
    await ensureDir(path.dirname(this.resolve(toRelative)));
    await rename(this.resolve(fromRelative), this.resolve(toRelative));
  }
}
