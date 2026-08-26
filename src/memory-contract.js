import { ValidationError } from "./errors.js";
import { isPlainObject, requirePlainObject } from "./util.js";

export const MEMORY_OPERATIONS = new Set([
  "role-compress",
  "session-handoff",
  "task-bootstrap",
  "long-term-candidate",
]);

export function validateMemoryRequest(request) {
  requirePlainObject(request, "Memory Worker request");
  if (!MEMORY_OPERATIONS.has(request.operation)) {
    throw new ValidationError(`Unsupported Memory Worker operation: ${request.operation}`);
  }
  if (!Array.isArray(request.source_files) || request.source_files.some((item) => typeof item !== "string")) {
    throw new ValidationError("source_files must be an array of paths.");
  }
  requirePlainObject(request.current_memory ?? {}, "current_memory");
  requirePlainObject(request.memory_hints ?? {}, "memory_hints");
  if (request.task_context != null && !isPlainObject(request.task_context)) {
    throw new ValidationError("task_context must be an object when provided.");
  }
  return request;
}

export function normalizeMemoryResponse(response, request) {
  requirePlainObject(response, "Memory Worker response");
  if (response.status !== "completed") {
    throw new ValidationError("Memory Worker response status must be completed.");
  }
  if (!isPlainObject(response.current) || !isPlainObject(response.current.content)) {
    throw new ValidationError("Memory Worker response must contain current.content.");
  }
  const references = response.references ?? [];
  if (!Array.isArray(references)) {
    throw new ValidationError("references must be an array.");
  }
  const normalizedReferences = references.map((reference, index) => {
    requirePlainObject(reference, `references[${index}]`);
    if (typeof reference.title !== "string" || reference.title.trim() === "") {
      throw new ValidationError(`references[${index}].title is required.`);
    }
    if (typeof reference.content !== "string") {
      throw new ValidationError(`references[${index}].content must be a string.`);
    }
    return {
      ...reference,
      source_refs: Array.isArray(reference.source_refs)
        ? reference.source_refs
        : [...request.source_files],
    };
  });
  const candidates = response.long_term_candidates ?? [];
  if (!Array.isArray(candidates)) {
    throw new ValidationError("long_term_candidates must be an array.");
  }
  return {
    status: "completed",
    current: response.current,
    references: normalizedReferences,
    discarded: response.discarded ?? null,
    long_term_candidates: candidates.map((candidate) =>
      isPlainObject(candidate) && !Array.isArray(candidate.source_refs)
        ? { ...candidate, source_refs: [...request.source_files] }
        : candidate,
    ),
    notes: response.notes ?? null,
  };
}
