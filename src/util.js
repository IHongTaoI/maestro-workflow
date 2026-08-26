import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { ValidationError } from "./errors.js";

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/;

export function assertSafeId(value, label = "id") {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new ValidationError(`${label} must match ${SAFE_ID}`);
  }
  return value;
}

export function makeId(prefix, now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${prefix}-${timestamp}-${randomUUID().slice(0, 8)}`;
}

export function runStamp(now = new Date()) {
  return `${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${randomUUID().slice(0, 8)}`;
}

export async function ensureDir(directory) {
  await mkdir(directory, { recursive: true });
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function atomicWriteJson(file, value) {
  await ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function requirePlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
  return value;
}

export function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}
