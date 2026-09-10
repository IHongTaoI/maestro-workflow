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

function runCatalog(projectRoot, args, { env } = {}) {
  return execFileAsync(python, [catalogScript, '--project-root', projectRoot, ...args], {
    cwd: repositoryRoot,
    windowsHide: true,
    env: { ...process.env, MAESTRO_CURRENT_TIME: '2026-09-10T12:00:00Z', ...env },
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

function entryFile(entry, { revision = 0, updatedAt = '2026-09-10T01:00:00Z' } = {}) {
  return `---
revision: ${revision}
updated_at: ${updatedAt}
updated_by: old-zhou/test
---

# Long-term Memory Entry

\`\`\`maestro-memory-entry
${JSON.stringify(entry)}
\`\`\`
`;
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
  await writeProjectFile(projectRoot, '.maestro/tasks/task-cache/workers/cache-observer/current-state.md', `# Objective

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
  const legacyPath = path.join(projectRoot, '.maestro', 'memory', 'long-term', 'current.md');
  const legacyBefore = await readFile(legacyPath, 'utf8');
  const build = JSON.parse((await runCatalog(projectRoot, ['build'])).stdout);
  assert.equal(build.status, 'built');
  assert.equal(build.entries, 5);
  assert.equal(await readFile(legacyPath, 'utf8'), legacyBefore);
  await assert.rejects(readFile(path.join(projectRoot,
    '.maestro/memory/long-term/entries/lt-startup-performance.md'), 'utf8'));

  const indexPath = path.join(projectRoot, '.maestro', 'memory', 'index.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  assert.deepEqual(index.entries.map((entry) => entry.memory_id), [
    'lt-old-workflow',
    'lt-startup-performance',
    'task-cache',
    'task-cache.worker-state.cache-observer',
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

test('indexes split Long-term files and updates one entry without rewriting another', async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'maestro-memory-split-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await writeProjectFile(projectRoot, '.maestro/evidence/source.md', '# Evidence\n');
  const first = {
    entry_id: 'lt-api-boundary', title: 'API boundary', memory_kind: 'principle',
    content: 'Keep API boundaries explicit.', source_refs: ['.maestro/evidence/source.md'], status: 'active',
  };
  const second = {
    entry_id: 'lt-worker-isolation', title: 'Worker isolation', memory_kind: 'decision',
    content: 'Workers receive bounded context.', source_refs: ['.maestro/evidence/source.md'], status: 'active',
    decision_context: { reason: 'Bounded context avoids hidden authority.' },
  };
  const old = {
    entry_id: 'lt-fixed-roles', title: 'Fixed roles', memory_kind: 'decision',
    content: 'Use fixed roles.', source_refs: ['.maestro/evidence/source.md'], status: 'superseded',
  };
  await writeProjectFile(projectRoot, '.maestro/memory/long-term/entries/lt-api-boundary.md', entryFile(first));
  await writeProjectFile(projectRoot, '.maestro/memory/long-term/entries/lt-worker-isolation.md',
    entryFile(second, { revision: 4, updatedAt: '2026-09-10T02:00:00Z' }));
  await writeProjectFile(projectRoot, '.maestro/memory/long-term/history/lt-fixed-roles.md', entryFile(old));

  await runCatalog(projectRoot, ['build']);
  const index = JSON.parse(await readFile(path.join(projectRoot, '.maestro/memory/index.json'), 'utf8'));
  assert.deepEqual(index.entries.map((entry) => entry.path), [
    '.maestro/memory/long-term/entries/lt-api-boundary.md',
    '.maestro/memory/long-term/history/lt-fixed-roles.md',
    '.maestro/memory/long-term/entries/lt-worker-isolation.md',
  ]);
  assert.equal(index.entries.find((entry) => entry.memory_id === 'lt-worker-isolation').updated_at,
    '2026-09-10T02:00:00Z');
  const before = await readFile(path.join(projectRoot,
    '.maestro/memory/long-term/entries/lt-worker-isolation.md'), 'utf8');
  first.content = 'Keep public API boundaries explicit and versioned.';
  await writeProjectFile(projectRoot, '.maestro/memory/long-term/entries/lt-api-boundary.md',
    entryFile(first, { revision: 1, updatedAt: '2026-09-10T03:00:00Z' }));
  await runCatalog(projectRoot, ['build']);
  assert.equal(await readFile(path.join(projectRoot,
    '.maestro/memory/long-term/entries/lt-worker-isolation.md'), 'utf8'), before);
  const detail = JSON.parse((await runCatalog(projectRoot, ['show', 'lt-api-boundary'])).stdout);
  assert.equal(detail.detail.content, 'Keep public API boundaries explicit and versioned.');
  const inactive = JSON.parse((await runCatalog(projectRoot,
    ['show', 'lt-fixed-roles', '--include-inactive'])).stdout);
  assert.equal(inactive.detail.status, 'superseded');
});

test('rejects duplicate IDs across legacy and split Long-term sources', async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'maestro-memory-duplicate-source-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await writeProjectFile(projectRoot, '.maestro/evidence/source.md', '# Evidence\n');
  const entry = {
    entry_id: 'lt-duplicate', title: 'Duplicate', memory_kind: 'fact', content: 'One claim.',
    source_refs: ['.maestro/evidence/source.md'], status: 'active',
  };
  await writeProjectFile(projectRoot, '.maestro/memory/long-term/current.md', `# Long-term Memory

\`\`\`maestro-memory-entry
${JSON.stringify(entry)}
\`\`\`
`);
  await writeProjectFile(projectRoot, '.maestro/memory/long-term/entries/lt-duplicate.md', entryFile(entry));
  const failure = await rejectedCommand(runCatalog(projectRoot, ['build']));
  assert.equal(failure.code, 2);
  assert.match(failure.stderr, /duplicate Long-term entry_id/);
});

test('split Long-term files enforce one matching entry and independent metadata', async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'maestro-memory-invalid-split-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await writeProjectFile(projectRoot, '.maestro/evidence/source.md', '# Evidence\n');
  const entry = {
    entry_id: 'lt-right-name', title: 'Right name', memory_kind: 'fact', content: 'A fact.',
    source_refs: ['.maestro/evidence/source.md'], status: 'active',
  };
  await writeProjectFile(projectRoot, '.maestro/memory/long-term/entries/lt-wrong-name.md', entryFile(entry));
  let failure = await rejectedCommand(runCatalog(projectRoot, ['build']));
  assert.match(failure.stderr, /filename must match entry_id/);

  await rm(path.join(projectRoot, '.maestro/memory/long-term/entries'), { recursive: true, force: true });
  await writeProjectFile(projectRoot, '.maestro/memory/long-term/entries/lt-right-name.md', `# Entry

\`\`\`maestro-memory-entry
${JSON.stringify(entry)}
\`\`\`
`);
  failure = await rejectedCommand(runCatalog(projectRoot, ['build']));
  assert.match(failure.stderr, /revision.*non-negative integer/);
});

test('explicit migration preserves legacy entries and leaves an auditable snapshot', async (t) => {
  const projectRoot = await createMemoryProject(t);
  const currentPath = path.join(projectRoot, '.maestro/memory/long-term/current.md');
  const original = await readFile(currentPath, 'utf8');
  const beforeActive = JSON.parse((await runCatalog(projectRoot,
    ['show', 'lt-startup-performance'])).stdout).detail;
  const beforeInactive = JSON.parse((await runCatalog(projectRoot,
    ['show', 'lt-old-workflow', '--include-inactive'])).stdout).detail;

  const preview = JSON.parse((await runCatalog(projectRoot, ['migrate-long-term'])).stdout);
  assert.equal(preview.status, 'ready');
  assert.equal(preview.entries, 2);
  await assert.rejects(readFile(path.join(projectRoot,
    '.maestro/memory/long-term/entries/lt-startup-performance.md'), 'utf8'));
  assert.equal(await readFile(currentPath, 'utf8'), original);

  const migrated = JSON.parse((await runCatalog(projectRoot,
    ['migrate-long-term', '--apply', '--actor', 'old-zhou/migration'])).stdout);
  assert.equal(migrated.status, 'migrated');
  assert.equal(migrated.current_entries, 1);
  assert.equal(migrated.history_entries, 1);
  assert.doesNotMatch(await readFile(currentPath, 'utf8'), /maestro-memory-entry/);
  assert.equal(await readFile(path.join(projectRoot, ...migrated.legacy_snapshot.split('/')), 'utf8'), original);

  const activeFile = await readFile(path.join(projectRoot,
    '.maestro/memory/long-term/entries/lt-startup-performance.md'), 'utf8');
  const historyFile = await readFile(path.join(projectRoot,
    '.maestro/memory/long-term/history/lt-old-workflow.md'), 'utf8');
  assert.match(activeFile, /revision: 2/);
  assert.match(historyFile, /status.*superseded/);
  const afterActive = JSON.parse((await runCatalog(projectRoot,
    ['show', 'lt-startup-performance'])).stdout).detail;
  const afterInactive = JSON.parse((await runCatalog(projectRoot,
    ['show', 'lt-old-workflow', '--include-inactive'])).stdout).detail;
  assert.deepEqual(afterActive, beforeActive);
  assert.deepEqual(afterInactive, beforeInactive);
  const check = JSON.parse((await runCatalog(projectRoot, ['check'])).stdout);
  assert.equal(check.entries, 5);
});

test('mixed-mode migration preserves existing split entries byte for byte', async (t) => {
  const projectRoot = await createMemoryProject(t);
  const existing = {
    entry_id: 'lt-existing-split', title: 'Existing split entry', memory_kind: 'principle',
    content: 'Keep this independently written entry unchanged.',
    source_refs: ['.maestro/evidence/performance.md'], status: 'active',
  };
  const existingPath = path.join(projectRoot,
    '.maestro/memory/long-term/entries/lt-existing-split.md');
  await writeProjectFile(projectRoot, '.maestro/memory/long-term/entries/lt-existing-split.md',
    entryFile(existing, { revision: 7, updatedAt: '2026-09-10T04:00:00Z' }));
  const before = await readFile(existingPath, 'utf8');

  const preview = JSON.parse((await runCatalog(projectRoot, ['migrate-long-term'])).stdout);
  assert.equal(preview.preserved_entries, 1);
  const migrated = JSON.parse((await runCatalog(projectRoot,
    ['migrate-long-term', '--apply', '--actor', 'old-zhou/migration'])).stdout);
  assert.equal(migrated.preserved_entries, 1);
  assert.equal(await readFile(existingPath, 'utf8'), before);
  assert.match(await readFile(path.join(projectRoot,
    '.maestro/memory/long-term/entries/lt-startup-performance.md'), 'utf8'),
  /lt-startup-performance/);
  const check = JSON.parse((await runCatalog(projectRoot, ['check'])).stdout);
  assert.equal(check.entries, 6);
});

test('migration ID conflict never changes either storage format', async (t) => {
  const projectRoot = await createMemoryProject(t);
  const currentPath = path.join(projectRoot, '.maestro/memory/long-term/current.md');
  const original = await readFile(currentPath, 'utf8');
  const duplicate = {
    entry_id: 'lt-startup-performance', title: 'Duplicate', memory_kind: 'experience',
    content: 'A conflicting split copy.', source_refs: ['.maestro/evidence/performance.md'],
    status: 'active',
  };
  const duplicatePath = path.join(projectRoot,
    '.maestro/memory/long-term/entries/lt-startup-performance.md');
  await writeProjectFile(projectRoot,
    '.maestro/memory/long-term/entries/lt-startup-performance.md', entryFile(duplicate));
  const duplicateBefore = await readFile(duplicatePath, 'utf8');
  const collision = await rejectedCommand(runCatalog(projectRoot,
    ['migrate-long-term', '--apply', '--actor', 'old-zhou/migration']));
  assert.equal(collision.code, 2);
  assert.match(collision.stderr, /duplicate Long-term entry_id/);
  assert.equal(await readFile(currentPath, 'utf8'), original);
  assert.equal(await readFile(duplicatePath, 'utf8'), duplicateBefore);

  await rm(path.join(projectRoot, '.maestro/memory/long-term/entries'), { recursive: true, force: true });
  const missingActor = await rejectedCommand(runCatalog(projectRoot, ['migrate-long-term', '--apply']));
  assert.equal(missingActor.code, 2);
  assert.match(missingActor.stderr, /--actor/);
  assert.equal(await readFile(currentPath, 'utf8'), original);
});

test('indexes long-term search hints, ranks by them with search hint reason, and preserves them on migration', async (t) => {
  const projectRoot = await createMemoryProject(t);
  const hintEntry = {
    entry_id: 'lt-with-hints',
    title: 'Startup tracing guidance',
    memory_kind: 'experience',
    content: 'Always capture CPU profiles before touching bootstrap.',
    source_refs: ['.maestro/evidence/performance.md'],
    tags: ['startup'],
    aliases: ['启动分析'],
    search_hints: ['优化启动性能', 'how to profile startup'],
    status: 'active',
  };
  await writeProjectFile(
    projectRoot,
    '.maestro/memory/long-term/entries/lt-with-hints.md',
    entryFile(hintEntry, { revision: 1, updatedAt: '2026-09-10T02:00:00Z' })
  );

  const build = JSON.parse((await runCatalog(projectRoot, ['build'])).stdout);
  assert.equal(build.status, 'built');

  const indexPath = path.join(projectRoot, '.maestro', 'memory', 'index.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  const stored = index.entries.find((e) => e.memory_id === 'lt-with-hints');
  assert.ok(stored);
  assert.deepEqual(stored.search_hints, ['优化启动性能', 'how to profile startup']);
  assert.equal(stored.stale, null);

  const search = JSON.parse((await runCatalog(projectRoot, ['search', 'how to profile startup'])).stdout);
  const match = search.candidates.find((e) => e.memory_id === 'lt-with-hints');
  assert.ok(match);
  assert.match(match.relevance_reason, /search hint/);

  // Validate index file with validatorScript
  await execFileAsync(python, [validatorScript, 'memory-index', indexPath, '--project-root', projectRoot]);
});

test('calculates active temporary staleness, marks stale in manifest and index, and honors config threshold', async (t) => {
  const projectRoot = await createMemoryProject(t);
  // temp-home has updated_at 2026-09-01T06:10:00Z (9 days before 2026-09-10) -> stale by default (7 days)
  await runCatalog(projectRoot, ['build']);

  const indexPath = path.join(projectRoot, '.maestro', 'memory', 'index.json');
  let index = JSON.parse(await readFile(indexPath, 'utf8'));
  let tempHome = index.entries.find((e) => e.memory_id === 'temp-home');
  assert.ok(tempHome);
  assert.equal(tempHome.stale, true);

  let manifest = await readFile(path.join(projectRoot, '.maestro', 'memory', 'manifest.md'), 'utf8');
  assert.match(manifest, /homepage startup investigation.*\(updated 2026-09-01, stale\)/);

  // Write a fresh temporary entry
  await writeProjectFile(projectRoot, '.maestro/memory/temporary/active/temp-fresh/meta.yaml', `id: temp-fresh
topic: fresh exploration
status: active
created_at: 2026-09-09T10:00:00Z
updated_at: 2026-09-09T10:00:00Z
updated_by: old-zhou/test
revision: 1
`);
  await writeProjectFile(projectRoot, '.maestro/memory/temporary/active/temp-fresh/current.md', `# Topic\nFresh exploration\n`);

  await runCatalog(projectRoot, ['build']);
  index = JSON.parse(await readFile(indexPath, 'utf8'));
  const tempFresh = index.entries.find((e) => e.memory_id === 'temp-fresh');
  assert.ok(tempFresh);
  assert.equal(tempFresh.stale, false);

  manifest = await readFile(path.join(projectRoot, '.maestro', 'memory', 'manifest.md'), 'utf8');
  assert.match(manifest, /fresh exploration.*\(updated 2026-09-09\)/);
  assert.doesNotMatch(manifest, /fresh exploration.*stale/);

  // Test time-crossing threshold via --now argument:
  // At 2026-09-05 (4 days after 2026-09-01), temp-home is fresh (within 7 days)
  await runCatalog(projectRoot, ['build', '--now', '2026-09-05T12:00:00Z']);
  index = JSON.parse(await readFile(indexPath, 'utf8'));
  assert.equal(index.entries.find((e) => e.memory_id === 'temp-home').stale, false);
  // Checking at 2026-09-10 (9 days after) detects catalog is stale because temp-home crossed threshold
  const thresholdCrossedCheck = await rejectedCommand(runCatalog(projectRoot, ['check', '--now', '2026-09-10T12:00:00Z']));
  assert.equal(thresholdCrossedCheck.code, 1);

  // Configure custom threshold in .maestro/config.yaml: 14 days
  await writeProjectFile(projectRoot, '.maestro/config.yaml', `temporary_stale_days: 14\n`);
  // Since config changed, check detects catalog is stale
  const staleCheck = await rejectedCommand(runCatalog(projectRoot, ['check']));
  assert.equal(staleCheck.code, 1);

  // Rebuild with 14 days threshold: 9-day-old temp-home is not stale
  await runCatalog(projectRoot, ['build']);
  index = JSON.parse(await readFile(indexPath, 'utf8'));
  tempHome = index.entries.find((e) => e.memory_id === 'temp-home');
  assert.equal(tempHome.stale, false);

  manifest = await readFile(path.join(projectRoot, '.maestro', 'memory', 'manifest.md'), 'utf8');
  assert.match(manifest, /homepage startup investigation.*\(updated 2026-09-01\)/);
  assert.doesNotMatch(manifest, /homepage startup investigation.*stale/);

  // Timezone enforcement on --now and MAESTRO_CURRENT_TIME:
  // Offset-aware timestamp with non-UTC offset succeeds
  await runCatalog(projectRoot, ['build', '--now', '2026-09-10T20:00:00+08:00']);
  await runCatalog(projectRoot, ['build'], { env: { MAESTRO_CURRENT_TIME: '2026-09-10T20:00:00+08:00' } });

  // Naive timestamps without timezone offset fail
  const naiveNowErr = await rejectedCommand(runCatalog(projectRoot, ['build', '--now', '2026-09-10T12:00:00']));
  assert.equal(naiveNowErr.code, 2);
  assert.match(naiveNowErr.stderr, /--now timestamp must include timezone offset/);

  const naiveEnvErr = await rejectedCommand(runCatalog(projectRoot, ['build'], { env: { MAESTRO_CURRENT_TIME: '2026-09-10T12:00:00' } }));
  assert.equal(naiveEnvErr.code, 2);
  assert.match(naiveEnvErr.stderr, /MAESTRO_CURRENT_TIME must include timezone offset/);
});

test('indexes pending follow-ups, exposes them in manifest, and supports show command', async (t) => {
  const projectRoot = await createMemoryProject(t);
  const pendingYaml = `followup_id: cleanup-redis
title: Clean up obsolete Redis cluster nodes
status: pending
created_at: 2026-09-09T12:00:00Z
source_refs:
  - .maestro/evidence/performance.md
related_ids:
  - lt-startup-performance
`;
  await writeProjectFile(projectRoot, '.maestro/memory/followups/pending/cleanup-redis.yaml', pendingYaml);

  const build = JSON.parse((await runCatalog(projectRoot, ['build'])).stdout);
  assert.equal(build.status, 'built');

  const indexPath = path.join(projectRoot, '.maestro', 'memory', 'index.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  assert.ok(Array.isArray(index.pending_followups));
  assert.equal(index.pending_followups.length, 1);
  const item = index.pending_followups[0];
  assert.equal(item.followup_id, 'cleanup-redis');
  assert.equal(item.title, 'Clean up obsolete Redis cluster nodes');
  assert.equal(item.status, 'pending');
  assert.deepEqual(item.source_refs, ['.maestro/evidence/performance.md']);
  assert.deepEqual(item.related_ids, ['lt-startup-performance']);
  assert.equal(item.path, '.maestro/memory/followups/pending/cleanup-redis.yaml');

  // Validate index via validator
  await execFileAsync(python, [validatorScript, 'memory-index', indexPath, '--project-root', projectRoot]);

  // Check manifest
  const manifest = await readFile(path.join(projectRoot, '.maestro', 'memory', 'manifest.md'), 'utf8');
  assert.match(manifest, /## Pending follow-ups/);
  assert.match(manifest, /- \*\*Clean up obsolete Redis cluster nodes\*\* \(`cleanup-redis`\) — from \.maestro\/evidence\/performance\.md/);

  // Show pending followup
  const showPending = JSON.parse((await runCatalog(projectRoot, ['show', 'cleanup-redis'])).stdout);
  assert.equal(showPending.followup.followup_id, 'cleanup-redis');
  assert.equal(showPending.followup.title, 'Clean up obsolete Redis cluster nodes');
  assert.equal(showPending.followup.status, 'pending');

  // Resolve the follow-up
  await rm(path.join(projectRoot, '.maestro/memory/followups/pending/cleanup-redis.yaml'));
  const resolvedYaml = `followup_id: cleanup-redis
title: Clean up obsolete Redis cluster nodes
status: resolved
created_at: 2026-09-09T12:00:00Z
source_refs:
  - .maestro/evidence/performance.md
related_ids:
  - lt-startup-performance
resolved_at: 2026-09-10T12:00:00Z
resolution: Decommissioned old nodes and updated routing config.
resolution_refs:
  - .maestro/evidence/performance.md
`;
  await writeProjectFile(projectRoot, '.maestro/memory/followups/resolved/cleanup-redis.yaml', resolvedYaml);

  await runCatalog(projectRoot, ['build']);
  const updatedIndex = JSON.parse(await readFile(indexPath, 'utf8'));
  assert.deepEqual(updatedIndex.pending_followups, []);

  const updatedManifest = await readFile(path.join(projectRoot, '.maestro', 'memory', 'manifest.md'), 'utf8');
  assert.match(updatedManifest, /## Pending follow-ups\s+- None/);

  // show without --include-inactive should fail
  const unavailable = await rejectedCommand(runCatalog(projectRoot, ['show', 'cleanup-redis']));
  assert.equal(unavailable.code, 2);
  assert.match(unavailable.stderr, /Follow-up 'cleanup-redis' is unavailable/);

  // show with --include-inactive succeeds
  const showResolved = JSON.parse((await runCatalog(projectRoot, ['show', 'cleanup-redis', '--include-inactive'])).stdout);
  assert.equal(showResolved.followup.status, 'resolved');
  assert.equal(showResolved.followup.resolution, 'Decommissioned old nodes and updated routing config.');
});

test('rejects invalid follow-ups on schema, status mismatch, filename, or ID collision', async (t) => {
  const projectRoot = await createMemoryProject(t);

  // 1. Filename mismatch
  await writeProjectFile(projectRoot, '.maestro/memory/followups/pending/mismatched.yaml', `followup_id: correct-id
title: Some Title
status: pending
created_at: 2026-09-09T12:00:00Z
source_refs:
  - .maestro/evidence/performance.md
`);
  let err = await rejectedCommand(runCatalog(projectRoot, ['build']));
  assert.equal(err.code, 2);
  assert.match(err.stderr, /filename must match followup_id/);
  await rm(path.join(projectRoot, '.maestro/memory/followups/pending/mismatched.yaml'));

  // 2. Status mismatch (resolved in pending folder)
  await writeProjectFile(projectRoot, '.maestro/memory/followups/pending/wrong-status.yaml', `followup_id: wrong-status
title: Some Title
status: resolved
created_at: 2026-09-09T12:00:00Z
source_refs:
  - .maestro/evidence/performance.md
resolved_at: 2026-09-10T12:00:00Z
resolution: done
`);
  err = await rejectedCommand(runCatalog(projectRoot, ['build']));
  assert.equal(err.code, 2);
  assert.match(err.stderr, /status must be 'pending' in pending directory/);
  await rm(path.join(projectRoot, '.maestro/memory/followups/pending/wrong-status.yaml'));

  // 3. Pending has resolution forbidden fields
  await writeProjectFile(projectRoot, '.maestro/memory/followups/pending/has-resolution.yaml', `followup_id: has-resolution
title: Some Title
status: pending
created_at: 2026-09-09T12:00:00Z
source_refs:
  - .maestro/evidence/performance.md
resolved_at: 2026-09-10T12:00:00Z
`);
  err = await rejectedCommand(runCatalog(projectRoot, ['build']));
  assert.equal(err.code, 2);
  assert.match(err.stderr, /\$\.resolved_at: is not allowed/);
  await rm(path.join(projectRoot, '.maestro/memory/followups/pending/has-resolution.yaml'));

  // 4. Invalid source_refs (non-existent file)
  await writeProjectFile(projectRoot, '.maestro/memory/followups/pending/bad-ref.yaml', `followup_id: bad-ref
title: Some Title
status: pending
created_at: 2026-09-09T12:00:00Z
source_refs:
  - .maestro/evidence/missing-file.md
`);
  err = await rejectedCommand(runCatalog(projectRoot, ['build']));
  assert.equal(err.code, 2);
  assert.match(err.stderr, /invalid follow-up/);
  await rm(path.join(projectRoot, '.maestro/memory/followups/pending/bad-ref.yaml'));

  // 5. Duplicate ID across pending and resolved
  await writeProjectFile(projectRoot, '.maestro/memory/followups/pending/dup-id.yaml', `followup_id: dup-id
title: Some Title
status: pending
created_at: 2026-09-09T12:00:00Z
source_refs:
  - .maestro/evidence/performance.md
`);
  await writeProjectFile(projectRoot, '.maestro/memory/followups/resolved/dup-id.yaml', `followup_id: dup-id
title: Some Title
status: resolved
created_at: 2026-09-09T12:00:00Z
source_refs:
  - .maestro/evidence/performance.md
resolved_at: 2026-09-10T12:00:00Z
resolution: done
`);
  err = await rejectedCommand(runCatalog(projectRoot, ['build']));
  assert.equal(err.code, 2);
  assert.match(err.stderr, /duplicate followup_id/);
  await rm(path.join(projectRoot, '.maestro/memory/followups'), { recursive: true, force: true });

  // 6. Followup ID collides with memory_id
  await writeProjectFile(projectRoot, '.maestro/memory/followups/pending/lt-startup-performance.yaml', `followup_id: lt-startup-performance
title: Colliding Title
status: pending
created_at: 2026-09-09T12:00:00Z
source_refs:
  - .maestro/evidence/performance.md
`);
  err = await rejectedCommand(runCatalog(projectRoot, ['build']));
  assert.equal(err.code, 2);
  assert.match(err.stderr, /collides with memory_id/);
  await rm(path.join(projectRoot, '.maestro/memory/followups'), { recursive: true, force: true });

  // 7. Unknown field disallowed (additionalProperties: false)
  await writeProjectFile(projectRoot, '.maestro/memory/followups/pending/unknown-field.yaml', `followup_id: unknown-field
title: Some Title
status: pending
created_at: 2026-09-09T12:00:00Z
source_refs:
  - .maestro/evidence/performance.md
unknown_field: disallowed
`);
  err = await rejectedCommand(runCatalog(projectRoot, ['build']));
  assert.equal(err.code, 2);
  assert.match(err.stderr, /\$\.unknown_field: is not allowed/);
  await rm(path.join(projectRoot, '.maestro/memory/followups'), { recursive: true, force: true });

  // 8. Duplicate source_refs disallowed (uniqueItems: true)
  await writeProjectFile(projectRoot, '.maestro/memory/followups/pending/dup-source-refs.yaml', `followup_id: dup-source-refs
title: Some Title
status: pending
created_at: 2026-09-09T12:00:00Z
source_refs:
  - .maestro/evidence/performance.md
  - .maestro/evidence/performance.md
`);
  err = await rejectedCommand(runCatalog(projectRoot, ['build']));
  assert.equal(err.code, 2);
  assert.match(err.stderr, /\$\.source_refs\[1\]: must be unique/);
  await rm(path.join(projectRoot, '.maestro/memory/followups'), { recursive: true, force: true });

  // 9. Duplicate related_ids disallowed (uniqueItems: true)
  await writeProjectFile(projectRoot, '.maestro/memory/followups/pending/dup-related-ids.yaml', `followup_id: dup-related-ids
title: Some Title
status: pending
created_at: 2026-09-09T12:00:00Z
source_refs:
  - .maestro/evidence/performance.md
related_ids:
  - lt-startup-performance
  - lt-startup-performance
`);
  err = await rejectedCommand(runCatalog(projectRoot, ['build']));
  assert.equal(err.code, 2);
  assert.match(err.stderr, /\$\.related_ids\[1\]: must be unique/);
  await rm(path.join(projectRoot, '.maestro/memory/followups'), { recursive: true, force: true });

  // 10. Duplicate resolution_refs disallowed in resolved follow-ups (uniqueItems: true)
  await writeProjectFile(projectRoot, '.maestro/memory/followups/resolved/dup-resolution-refs.yaml', `followup_id: dup-resolution-refs
title: Some Title
status: resolved
created_at: 2026-09-09T12:00:00Z
source_refs:
  - .maestro/evidence/performance.md
resolved_at: 2026-09-10T12:00:00Z
resolution: Decommissioned old nodes
resolution_refs:
  - .maestro/evidence/performance.md
  - .maestro/evidence/performance.md
`);
  err = await rejectedCommand(runCatalog(projectRoot, ['build']));
  assert.equal(err.code, 2);
  assert.match(err.stderr, /\$\.resolution_refs\[1\]: must be unique/);
  await rm(path.join(projectRoot, '.maestro/memory/followups'), { recursive: true, force: true });
});
