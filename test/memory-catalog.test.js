import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const python = process.platform === 'win32' ? 'python' : 'python3';
const catalogScript = path.join(repositoryRoot, 'maestro', 'scripts', 'memory_catalog.py');
const validatorScript = path.join(repositoryRoot, 'maestro', 'scripts', 'validate.py');

function runCatalog(projectRoot, args) {
  return execFileAsync(python, [catalogScript, '--project-root', projectRoot, ...args], {
    cwd: repositoryRoot,
    windowsHide: true,
  });
}

async function rejectedCommand(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('Expected command to fail');
}

async function writeProjectFile(projectRoot, relativePath, content) {
  const target = path.join(projectRoot, ...relativePath.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function createMemoryProject(t) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'maestro-memory-catalog-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await writeProjectFile(projectRoot, '.maestro/evidence/performance.md', '# Trace\nVerified startup bottleneck.\n');
  await writeProjectFile(projectRoot, '.maestro/memory/long-term/current.md', `---
revision: 2
updated_at: 2026-09-01T06:00:00Z
updated_by: old-zhou/test
---

# Long-term Memory

\`\`\`maestro-memory-entry
{"entry_id":"lt-startup-performance","title":"Startup performance evidence","memory_kind":"experience","content":"Collect a trace before changing homepage initialization.","source_refs":[".maestro/evidence/performance.md"],"tags":["performance","trace"],"aliases":["首屏性能"],"status":"active"}
\`\`\`

\`\`\`maestro-memory-entry
{"entry_id":"lt-old-workflow","title":"Old workflow preference","memory_kind":"decision","content":"Always use a fixed workflow.","decision_context":{"reason":"The original design optimized for predictable stage order.","rejected_alternatives":[{"alternative":"Dynamic role selection","reason":"It was initially considered harder to test."}]},"source_refs":[".maestro/evidence/performance.md"],"tags":["workflow"],"status":"superseded"}
\`\`\`
`);
  await writeProjectFile(projectRoot, '.maestro/memory/temporary/active/temp-home/meta.yaml', `id: temp-home
topic: homepage startup investigation
status: active
created_at: 2026-09-01T05:00:00Z
updated_at: 2026-09-01T06:10:00Z
updated_by: old-zhou/test
revision: 3
aliases:
  - 首页启动
`);
  await writeProjectFile(projectRoot, '.maestro/memory/temporary/active/temp-home/current.md', `---
revision: 3
updated_at: 2026-09-01T06:10:00Z
updated_by: old-zhou/test
---

# Topic

Homepage startup investigation

## Current goal

Verify whether the analytics SDK must initialize synchronously.

## Confirmed

- A trace shows a long main-thread task.

## Open questions

- Can SDK initialization move after first paint?
`);
  await writeProjectFile(projectRoot, '.maestro/tasks/task-cache/task.yaml', `id: task-cache
objective: Reduce cache invalidation latency
status: active
created_at: 2026-09-01T05:30:00Z
updated_at: 2026-09-01T06:20:00Z
updated_by: old-zhou/test
revision: 1
`);
  await writeProjectFile(projectRoot, '.maestro/tasks/task-cache/context.md', `# Current state

Cache key analysis is complete.

## Open items

- Verify invalidation fan-out.
`);
  await writeProjectFile(projectRoot, '.maestro/tasks/task-cache/roles/laborer/current-state.md', `# Objective

Measure cache invalidation fan-out.

## Key findings

- One invalidation touches twelve regions.

## Recommended next

- Add a bounded batch size experiment.
`);
  return projectRoot;
}

test('builds a three-layer catalog and selectively returns one Memory detail', async (t) => {
  const projectRoot = await createMemoryProject(t);
  const build = JSON.parse((await runCatalog(projectRoot, ['build'])).stdout);
  assert.equal(build.status, 'built');
  assert.equal(build.entries, 5);

  const indexPath = path.join(projectRoot, '.maestro', 'memory', 'index.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  assert.deepEqual(index.entries.map((entry) => entry.memory_id), [
    'lt-old-workflow',
    'lt-startup-performance',
    'task-cache.role-state.laborer',
    'task-cache',
    'temp-home',
  ]);

  await execFileAsync(python, [
    validatorScript,
    'memory-index',
    indexPath,
    '--project-root',
    projectRoot,
  ]);

  const manifest = await readFile(path.join(projectRoot, '.maestro', 'memory', 'manifest.md'), 'utf8');
  assert.match(manifest, /Startup performance evidence/);
  assert.match(manifest, /homepage startup investigation/);
  assert.doesNotMatch(manifest, /Always use a fixed workflow/);

  const search = JSON.parse((await runCatalog(projectRoot, ['search', 'homepage trace performance'])).stdout);
  assert.equal(search.candidates[0].memory_id, 'lt-startup-performance');
  assert.equal(search.candidates.some((entry) => entry.memory_id === 'lt-old-workflow'), false);
  assert.match(search.candidates[0].relevance_reason, /tag|title|summary/);

  const detail = JSON.parse((await runCatalog(projectRoot, ['show', 'lt-startup-performance'])).stdout);
  assert.equal(detail.detail.entry_id, 'lt-startup-performance');
  assert.equal(detail.detail.content, 'Collect a trace before changing homepage initialization.');
  assert.doesNotMatch(JSON.stringify(detail.detail), /fixed workflow/);

  const inactive = await rejectedCommand(runCatalog(projectRoot, ['show', 'lt-old-workflow']));
  assert.equal(inactive.code, 2);
  assert.match(inactive.stderr, /unavailable/);
});

test('detects stale catalogs and refreshes them before search', async (t) => {
  const projectRoot = await createMemoryProject(t);
  await runCatalog(projectRoot, ['build']);
  const currentPath = '.maestro/memory/temporary/active/temp-home/current.md';
  await writeProjectFile(projectRoot, currentPath, `# Current goal

Investigate hydrationwaterfall latency.

## Open questions

- Which component blocks hydrationwaterfall?
`);

  const stale = await rejectedCommand(runCatalog(projectRoot, ['check']));
  assert.equal(stale.code, 1);
  assert.match(stale.stderr, /missing or stale/);

  const search = JSON.parse((await runCatalog(projectRoot, ['search', 'hydrationwaterfall'])).stdout);
  assert.equal(search.catalog_refreshed, true);
  assert.equal(search.candidates[0].memory_id, 'temp-home');
  const current = JSON.parse((await runCatalog(projectRoot, ['check'])).stdout);
  assert.equal(current.status, 'current');

  const manifestPath = path.join(projectRoot, '.maestro', 'memory', 'manifest.md');
  await rm(manifestPath);
  const missingManifest = await rejectedCommand(runCatalog(projectRoot, ['check']));
  assert.equal(missingManifest.code, 1);
  await runCatalog(projectRoot, ['search', 'hydrationwaterfall']);
  assert.match(await readFile(manifestPath, 'utf8'), /Memory Overview/);
});

test('returns no candidate instead of forcing unrelated Memory into context', async (t) => {
  const projectRoot = await createMemoryProject(t);
  const search = JSON.parse((await runCatalog(projectRoot, ['search', 'database backup encryption'])).stdout);
  assert.deepEqual(search.candidates, []);
});

test('rejects unstructured Long-term Memory instead of silently creating a weak index', async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'maestro-memory-invalid-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await writeProjectFile(projectRoot, '.maestro/memory/long-term/current.md', '# Long-term Memory\n\n- An unstructured claim\n');

  const failure = await rejectedCommand(runCatalog(projectRoot, ['build']));
  assert.equal(failure.code, 2);
  assert.match(failure.stderr, /maestro-memory-entry/);
});

test('rejects decision context on a non-decision Long-term entry', async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'maestro-memory-decision-invalid-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await writeProjectFile(projectRoot, '.maestro/evidence/source.md', '# Evidence\n');
  await writeProjectFile(projectRoot, '.maestro/memory/long-term/current.md', `# Long-term Memory

\`\`\`maestro-memory-entry
{"entry_id":"lt-invalid","title":"Invalid context","memory_kind":"fact","content":"Facts do not carry decision context.","decision_context":{"reason":"Invalid fixture."},"source_refs":[".maestro/evidence/source.md"]}
\`\`\`
`);

  const failure = await rejectedCommand(runCatalog(projectRoot, ['build']));
  assert.equal(failure.code, 2);
  assert.match(failure.stderr, /decision_context.*only.*decision/);
});
