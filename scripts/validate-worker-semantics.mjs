import fs from "node:fs";

const [kind, dataPath] = process.argv.slice(2);

if (!kind || !dataPath) {
  console.error("Usage: node scripts/validate-worker-semantics.mjs <requirements|worker|registry|delegation> <data-path>");
  process.exit(2);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
} catch (error) {
  console.error(`Cannot read ${dataPath}: ${error.message}`);
  process.exit(2);
}

const errors = [];

function validateInstructionSets(worker, label) {
  const required = new Set(worker.instructions?.required ?? []);
  const overlap = (worker.instructions?.optional ?? []).filter((ref) => required.has(ref));
  if (overlap.length > 0) {
    errors.push(`${label} instruction refs cannot be both required and optional: ${overlap.join(", ")}`);
  }
}

if (kind === "requirements") {
  const required = new Set(data.required_capabilities ?? []);
  const overlap = (data.optional_capabilities ?? []).filter((capability) => required.has(capability));
  if (overlap.length > 0) {
    errors.push(`capabilities cannot be both required and optional: ${overlap.join(", ")}`);
  }
} else if (kind === "worker") {
  validateInstructionSets(data, `Worker '${data.id ?? "unknown"}'`);
} else if (kind === "registry") {
  const seen = new Set();
  const duplicates = new Set();
  for (const worker of data.workers ?? []) {
    if (seen.has(worker.id)) duplicates.add(worker.id);
    seen.add(worker.id);
    validateInstructionSets(worker, `Worker '${worker.id ?? "unknown"}'`);
  }
  if (duplicates.size > 0) {
    errors.push(`duplicate Worker IDs: ${[...duplicates].join(", ")}`);
  }
} else if (kind === "delegation") {
  const required = new Set(data.instructions?.required_refs ?? []);
  const optional = new Set(data.instructions?.optional_refs ?? []);
  const overlap = [...optional].filter((ref) => required.has(ref));
  if (overlap.length > 0) {
    errors.push(`instruction refs cannot be both required and optional: ${overlap.join(", ")}`);
  }

  const resolved = new Set();
  for (const instruction of data.instructions?.resolved ?? []) {
    if (resolved.has(instruction.ref)) {
      errors.push(`duplicate resolved instruction ref: ${instruction.ref}`);
    }
    resolved.add(instruction.ref);
    if (!required.has(instruction.ref) && !optional.has(instruction.ref)) {
      errors.push(`resolved instruction ref was not declared by the packet: ${instruction.ref}`);
    }
  }

  const missingRequired = [...required].filter((ref) => !resolved.has(ref));
  if (data.host_adapter?.status !== "unsupported" && missingRequired.length > 0) {
    errors.push(`required instruction refs were not resolved: ${missingRequired.join(", ")}`);
  }
  if (data.host_adapter?.status === "unsupported") {
    const unsupported = new Set(data.host_adapter.unsupported_requirements ?? []);
    const unreported = missingRequired.filter((ref) => !unsupported.has(`instruction:${ref}`));
    if (unreported.length > 0) {
      errors.push(`missing required instruction refs were not reported: ${unreported.join(", ")}`);
    }
  }
} else {
  console.error(`Unknown contract kind: ${kind}`);
  process.exit(2);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`${dataPath}: ${error}`);
  process.exit(1);
}
