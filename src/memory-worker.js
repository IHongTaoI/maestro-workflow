import { normalizeMemoryResponse, validateMemoryRequest } from "./memory-contract.js";

async function attemptRunner(runner, tier, request, attempts) {
  try {
    const raw = await runner(request);
    const result = normalizeMemoryResponse(raw, request);
    attempts.push({ tier, status: "completed" });
    return result;
  } catch (error) {
    attempts.push({ tier, status: "failed", error: error.message });
    return null;
  }
}

export async function runMemoryWorker({ request, memoryRunner, primaryRunner }) {
  validateMemoryRequest(request);
  const attempts = [];

  if (typeof memoryRunner === "function") {
    for (let number = 1; number <= 2; number += 1) {
      const result = await attemptRunner(memoryRunner, `memory:${number}`, request, attempts);
      if (result) {
        return { status: "completed", model_tier: "memory", attempts, result };
      }
    }
  }

  if (typeof primaryRunner === "function") {
    const result = await attemptRunner(primaryRunner, "primary:1", request, attempts);
    if (result) {
      return { status: "completed", model_tier: "primary", attempts, result };
    }
  }

  return {
    status: "pending",
    reason: attempts.length === 0 ? "no_model_runner" : "all_model_attempts_failed",
    attempts,
    request,
  };
}
