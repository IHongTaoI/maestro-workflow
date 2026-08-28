import fs from "node:fs";

const [kind, dataPath] = process.argv.slice(2);

if (!kind || !dataPath) {
  console.error("Usage: node scripts/validate-worker-semantics.mjs <requirements|registry> <data-path>");
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

if (kind === "requirements") {
  const required = new Set(data.required_capabilities ?? []);
  const overlap = (data.optional_capabilities ?? []).filter((capability) => required.has(capability));
  if (overlap.length > 0) {
    errors.push(`capabilities cannot be both required and optional: ${overlap.join(", ")}`);
  }
} else if (kind === "registry") {
  const seen = new Set();
  const duplicates = new Set();
  for (const worker of data.workers ?? []) {
    if (seen.has(worker.id)) duplicates.add(worker.id);
    seen.add(worker.id);
  }
  if (duplicates.size > 0) {
    errors.push(`duplicate Worker IDs: ${[...duplicates].join(", ")}`);
  }
} else {
  console.error(`Unknown contract kind: ${kind}`);
  process.exit(2);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`${dataPath}: ${error}`);
  process.exit(1);
}
