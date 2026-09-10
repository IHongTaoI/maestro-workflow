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
const activityScript = path.join(repositoryRoot, 'maestro', 'scripts', 'activity_catalog.py');

function runActivity(projectRoot, args, { env } = {}) {
  return execFileAsync(python, [activityScript, '--project-root', projectRoot, ...args], {
    cwd: repositoryRoot,
    windowsHide: true,
    env: { ...process.env, ...env },
  });
}

function parseJson(result) {
  return JSON.parse(result.stdout);
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

async function createProject(t) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'maestro-activity-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  return projectRoot;
}

function recordArgs(overrides = {}) {
  return [
    'record',
    '--event-type', overrides.eventType ?? 'task_completed',
    '--occurred-at', overrides.occurredAt ?? '2026-09-01T10:30:00+08:00',
    '--title', overrides.title ?? '完成示例任务',
    '--summary', overrides.summary ?? '示例任务完成',
    '--source-ref', overrides.sourceRef ?? '.maestro/tasks/task-a/task.yaml',
  ];
}

async function seedSource(projectRoot) {
  await writeProjectFile(projectRoot, '.maestro/tasks/task-a/task.yaml', 'objective: demo\n');
}

test('record appends once and is idempotent by deterministic event_id', async (t) => {
  const projectRoot = await createProject(t);
  await seedSource(projectRoot);

  const first = parseJson(await runActivity(projectRoot, recordArgs()));
  const second = parseJson(await runActivity(projectRoot, recordArgs()));

  assert.equal(first.status, 'recorded');
  assert.equal(second.status, 'already-recorded');
  assert.equal(first.event_id, second.event_id);
  assert.match(first.event_id, /^activity-20260901-[0-9a-f]{8}$/);

  const logPath = path.join(projectRoot, '.maestro', 'activity', 'events', '2026', '09.jsonl');
  const lines = (await readFile(logPath, 'utf8')).split('\n').filter((line) => line.trim());
  assert.equal(lines.length, 1);
});

test('normalizes occurred_at to UTC and sorts events by time', async (t) => {
  const projectRoot = await createProject(t);
  await seedSource(projectRoot);

  await runActivity(projectRoot, recordArgs({
    occurredAt: '2026-09-05T10:00:00+08:00',
    title: '较晚的事件',
  }));
  await runActivity(projectRoot, recordArgs({
    occurredAt: '2026-09-01T10:30:00+08:00',
    title: '较早的事件',
  }));

  const result = parseJson(await runActivity(projectRoot, ['search', '--month', '2026-09']));
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].title, '较早的事件');
  assert.equal(result.events[1].title, '较晚的事件');
  // +08:00 10:30 归一化为 UTC 02:30
  assert.equal(result.events[0].occurred_at, '2026-09-01T02:30:00Z');
});

test('search filters by year, month, and from/to range', async (t) => {
  const projectRoot = await createProject(t);
  await seedSource(projectRoot);

  await runActivity(projectRoot, recordArgs({
    occurredAt: '2026-08-15T10:00:00Z', title: '八月事件', sourceRef: '.maestro/tasks/task-a/task.yaml',
  }));
  await runActivity(projectRoot, recordArgs({
    occurredAt: '2026-09-10T10:00:00Z', title: '九月事件', sourceRef: '.maestro/tasks/task-a/task.yaml',
  }));
  await runActivity(projectRoot, recordArgs({
    occurredAt: '2026-10-01T10:00:00Z', title: '十月事件', sourceRef: '.maestro/tasks/task-a/task.yaml',
  }));

  const byYear = parseJson(await runActivity(projectRoot, ['search', '--year', '2026']));
  assert.equal(byYear.events.length, 3);

  const byMonth = parseJson(await runActivity(projectRoot, ['search', '--month', '2026-09']));
  assert.equal(byMonth.events.length, 1);
  assert.equal(byMonth.events[0].title, '九月事件');

  const byRange = parseJson(
    await runActivity(projectRoot, ['search', '--from', '2026-09-01', '--to', '2026-09-30']),
  );
  assert.equal(byRange.events.length, 1);
  assert.equal(byRange.events[0].title, '九月事件');
});

test('search filters by event_type', async (t) => {
  const projectRoot = await createProject(t);
  await seedSource(projectRoot);

  await runActivity(projectRoot, recordArgs({ title: '完成任务事件' }));
  await runActivity(projectRoot, recordArgs({
    eventType: 'decision_approved',
    occurredAt: '2026-09-02T10:00:00Z',
    title: '批准决策事件',
  }));

  const tasks = parseJson(
    await runActivity(projectRoot, ['search', '--month', '2026-09', '--event-type', 'task_completed']),
  );
  assert.equal(tasks.events.length, 1);
  assert.equal(tasks.events[0].title, '完成任务事件');

  const decisions = parseJson(
    await runActivity(projectRoot, ['search', '--month', '2026-09', '--event-type', 'decision_approved']),
  );
  assert.equal(decisions.events.length, 1);
  assert.equal(decisions.events[0].title, '批准决策事件');
});

test('rejects an event_type outside the allow-list', async (t) => {
  const projectRoot = await createProject(t);
  await seedSource(projectRoot);
  await rejectedCommand(runActivity(projectRoot, recordArgs({ eventType: 'file_read' })));
});

test('rejects an unreachable source_ref', async (t) => {
  const projectRoot = await createProject(t);
  const error = await rejectedCommand(
    runActivity(projectRoot, recordArgs({ sourceRef: '.maestro/tasks/missing/task.yaml' })),
  );
  assert.match(error.stderr, /activity catalog error/);
});

test('rebuilds a missing index on search', async (t) => {
  const projectRoot = await createProject(t);
  await seedSource(projectRoot);
  await runActivity(projectRoot, recordArgs());

  const first = parseJson(await runActivity(projectRoot, ['search', '--month', '2026-09']));
  assert.equal(first.catalog_refreshed, true);
  assert.equal(first.events.length, 1);

  await rm(path.join(projectRoot, '.maestro', 'activity', 'index.json'), { force: true });
  const second = parseJson(await runActivity(projectRoot, ['search', '--month', '2026-09']));
  assert.equal(second.catalog_refreshed, true);
  assert.equal(second.events.length, 1);
});

test('check reports stale after a new event is recorded', async (t) => {
  const projectRoot = await createProject(t);
  await seedSource(projectRoot);

  await runActivity(projectRoot, recordArgs());
  await runActivity(projectRoot, ['build']);
  const current = parseJson(await runActivity(projectRoot, ['check']));
  assert.equal(current.status, 'current');

  await runActivity(projectRoot, recordArgs({
    occurredAt: '2026-09-03T10:00:00Z', title: '第二条事件',
  }));
  await rejectedCommand(runActivity(projectRoot, ['check']));
});
