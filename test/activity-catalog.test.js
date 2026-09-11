import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const python = process.platform === 'win32' ? 'python' : 'python3';
const activityScript = path.join(repositoryRoot, 'maestro', 'scripts', 'activity_catalog.py');

function runActivity(projectRoot, args) {
  return execFileAsync(python, [activityScript, '--project-root', projectRoot, ...args], {
    cwd: repositoryRoot,
    windowsHide: true,
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
  return target;
}

async function createProject(t) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'maestro-activity-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  return projectRoot;
}

function taskYaml({
  id = 'task-a',
  objective = '完成示例任务',
  status = 'completed',
  completedAt = '2026-09-01T10:30:00+08:00',
  updatedAt = '2026-09-02T00:00:00Z',
} = {}) {
  const lines = [
    `id: ${id}`,
    `objective: ${objective}`,
    `status: ${status}`,
    'created_at: 2026-08-31T00:00:00Z',
    `updated_at: ${updatedAt}`,
    'updated_by: old-zhou/test',
    'revision: 1',
  ];
  if (typeof completedAt === 'string') lines.push(`completed_at: ${completedAt}`);
  return `${lines.join('\n')}\n`;
}

async function seedTask(projectRoot, options = {}, root = '.maestro/tasks') {
  const id = options.id ?? 'task-a';
  return writeProjectFile(projectRoot, `${root}/${id}/task.yaml`, taskYaml(options));
}

function decisionRecord({
  id,
  title,
  outcome = 'approved',
  decidedAt,
  reason = '已有证据支持该决定。',
  supersededBy,
} = {}) {
  const record = {
    schema_version: 1,
    record_type: 'decision',
    decision_id: id,
    title,
    outcome,
    importance: 'milestone',
    decided_at: decidedAt,
    decided_by: 'old-zhou/test',
    reason,
    target_ids: ['lt-example'],
    source_refs: ['.maestro/evidence/decision.md'],
  };
  if (supersededBy !== undefined) record.superseded_by = supersededBy;
  return `${JSON.stringify(record, null, 2)}\n`;
}

async function seedDecision(projectRoot, options, fileId = options.id) {
  await writeProjectFile(projectRoot, '.maestro/evidence/decision.md', 'decision evidence\n');
  return writeProjectFile(
    projectRoot,
    `.maestro/memory/long-term/decisions/${fileId}.decision.json`,
    decisionRecord(options),
  );
}

test('completed Task automatically becomes a UTC Activity event without an event journal', async (t) => {
  const projectRoot = await createProject(t);
  await seedTask(projectRoot);

  const result = parseJson(await runActivity(projectRoot, [
    'search', '--month', '2026-09', '--now', '2026-09-10T00:00:00Z',
  ]));

  assert.equal(result.catalog_refreshed, true);
  assert.equal(result.total, 1);
  assert.equal(result.events[0].event_type, 'task_completed');
  assert.equal(result.events[0].occurred_at, '2026-09-01T02:30:00Z');
  assert.deepEqual(result.events[0].source_refs, ['.maestro/tasks/task-a/task.yaml']);
  await assert.rejects(access(path.join(projectRoot, '.maestro', 'activity', 'events')));
});

test('active and legacy completed Tasks are omitted instead of guessing timestamps', async (t) => {
  const projectRoot = await createProject(t);
  await seedTask(projectRoot, { id: 'active-task', status: 'active', completedAt: null });
  await seedTask(projectRoot, {
    id: 'legacy-task', status: 'completed', completedAt: null, updatedAt: '2026-09-08T00:00:00Z',
  });

  const result = parseJson(await runActivity(projectRoot, ['search', '--year', '2026']));
  assert.equal(result.total, 0);
  assert.deepEqual(result.events, []);
});

test('Task metadata files below artifacts or references are ignored', async (t) => {
  const projectRoot = await createProject(t);
  await seedTask(projectRoot);
  await writeProjectFile(
    projectRoot,
    '.maestro/tasks/task-a/artifacts/task.yaml',
    taskYaml({ id: 'task-a', objective: '不应进入时间线' }),
  );
  await writeProjectFile(
    projectRoot,
    '.maestro/tasks/task-a/references/task.yaml',
    '这不是 Task 元数据，也不应让构建失败\n',
  );

  const result = parseJson(await runActivity(projectRoot, ['search', '--year', '2026']));
  assert.equal(result.total, 1);
  assert.equal(result.events[0].title, '完成示例任务');
});

test('moving a Task to archive keeps the event and refreshes its source reference', async (t) => {
  const projectRoot = await createProject(t);
  await seedTask(projectRoot);
  const before = parseJson(await runActivity(projectRoot, ['search', '--year', '2026']));

  const activeDir = path.join(projectRoot, '.maestro', 'tasks', 'task-a');
  const archiveDir = path.join(projectRoot, '.maestro', 'tasks', 'archive', 'task-a');
  await mkdir(path.dirname(archiveDir), { recursive: true });
  await rename(activeDir, archiveDir);

  const after = parseJson(await runActivity(projectRoot, ['search', '--year', '2026']));
  assert.equal(after.catalog_refreshed, true);
  assert.equal(after.events[0].event_id, before.events[0].event_id);
  assert.deepEqual(after.events[0].source_refs, ['.maestro/tasks/archive/task-a/task.yaml']);
  await access(path.join(projectRoot, ...after.events[0].source_refs[0].split('/')));
});

test('approved and superseded Decision Records become Activity events', async (t) => {
  const projectRoot = await createProject(t);
  await seedDecision(projectRoot, {
    id: 'decision-approve',
    title: '采用派生 Activity',
    decidedAt: '2026-09-04T10:00:00+08:00',
  });
  await seedDecision(projectRoot, {
    id: 'decision-supersede',
    title: '取代旧索引方案',
    outcome: 'superseded',
    decidedAt: '2026-09-05T03:00:00Z',
    supersededBy: 'decision-approve',
  });
  await seedDecision(projectRoot, {
    id: 'decision-reject',
    title: '拒绝事件日志方案',
    outcome: 'rejected',
    decidedAt: '2026-09-06T03:00:00Z',
  });
  const routine = JSON.parse(decisionRecord({
    id: 'decision-routine',
    title: '普通评审决定',
    decidedAt: '2026-09-07T03:00:00Z',
  }));
  routine.importance = 'routine';
  await writeProjectFile(
    projectRoot,
    '.maestro/memory/long-term/decisions/decision-routine.decision.json',
    `${JSON.stringify(routine)}\n`,
  );

  const result = parseJson(await runActivity(projectRoot, ['search', '--month', '2026-09']));
  assert.equal(result.total, 2);
  assert.deepEqual(
    result.events.map((event) => event.event_type),
    ['decision_approved', 'decision_superseded'],
  );
  assert.equal(result.events[0].occurred_at, '2026-09-04T02:00:00Z');
  assert.deepEqual(result.events[0].source_refs, [
    '.maestro/memory/long-term/decisions/decision-approve.decision.json',
  ]);

  const approved = parseJson(await runActivity(projectRoot, [
    'search', '--year', '2026', '--event-type', 'decision_approved',
  ]));
  assert.equal(approved.total, 1);
  assert.equal(approved.events[0].title, '采用派生 Activity');
});

test('legacy and nested Decision files are ignored', async (t) => {
  const projectRoot = await createProject(t);
  await seedDecision(projectRoot, {
    id: 'decision-current',
    title: '规范决定',
    decidedAt: '2026-09-04T02:00:00Z',
  });
  await writeProjectFile(
    projectRoot,
    '.maestro/memory/long-term/decisions/legacy.json',
    '{old unstructured record',
  );
  await writeProjectFile(
    projectRoot,
    '.maestro/memory/long-term/decisions/archive/nested.decision.json',
    '{broken nested record',
  );

  const result = parseJson(await runActivity(projectRoot, ['search', '--year', '2026']));
  assert.equal(result.total, 1);
  assert.equal(result.events[0].title, '规范决定');
});

test('invalid canonical Decision Records fail instead of inventing an event', async (t) => {
  const projectRoot = await createProject(t);
  await writeProjectFile(projectRoot, '.maestro/evidence/decision.md', 'decision evidence\n');
  const invalid = JSON.parse(decisionRecord({
    id: 'decision-invalid',
    title: '缺少可靠时间',
    decidedAt: '2026-09-04T02:00:00Z',
  }));
  delete invalid.decided_at;
  await writeProjectFile(
    projectRoot,
    '.maestro/memory/long-term/decisions/decision-invalid.decision.json',
    `${JSON.stringify(invalid)}\n`,
  );

  const error = await rejectedCommand(runActivity(projectRoot, ['build']));
  assert.match(error.stderr, /invalid Decision Record.*decided_at/);
});

test('adding an authoritative Decision Record makes the Activity index stale', async (t) => {
  const projectRoot = await createProject(t);
  await runActivity(projectRoot, ['build', '--now', '2026-09-10T00:00:00Z']);
  await seedDecision(projectRoot, {
    id: 'decision-after-build',
    title: '索引构建后批准的新决定',
    decidedAt: '2026-09-10T01:00:00Z',
  });

  const stale = await rejectedCommand(runActivity(projectRoot, ['check']));
  assert.equal(stale.code, 1);
  assert.match(stale.stderr, /missing or stale/);

  const refreshed = parseJson(await runActivity(projectRoot, ['search', '--year', '2026']));
  assert.equal(refreshed.catalog_refreshed, true);
  assert.equal(refreshed.events[0].event_type, 'decision_approved');
});

test('search filters by year, month, and from/to range', async (t) => {
  const projectRoot = await createProject(t);
  await seedTask(projectRoot, { id: 'august', objective: '八月事件', completedAt: '2026-08-15T10:00:00Z' });
  await seedTask(projectRoot, { id: 'september', objective: '九月事件', completedAt: '2026-09-10T10:00:00Z' });
  await seedTask(projectRoot, { id: 'october', objective: '十月事件', completedAt: '2026-10-01T10:00:00Z' });

  assert.equal(parseJson(await runActivity(projectRoot, ['search', '--year', '2026'])).total, 3);

  const byMonth = parseJson(await runActivity(projectRoot, ['search', '--month', '2026-09']));
  assert.equal(byMonth.total, 1);
  assert.equal(byMonth.events[0].title, '九月事件');

  const byRange = parseJson(await runActivity(projectRoot, [
    'search', '--from', '2026-09-01', '--to', '2026-09-30',
  ]));
  assert.equal(byRange.total, 1);
  assert.equal(byRange.events[0].title, '九月事件');
});

test('search limits output to the newest matches while reporting the full total', async (t) => {
  const projectRoot = await createProject(t);
  await seedTask(projectRoot, { id: 'first', objective: '第一项', completedAt: '2026-09-01T00:00:00Z' });
  await seedTask(projectRoot, { id: 'second', objective: '第二项', completedAt: '2026-09-02T00:00:00Z' });
  await seedTask(projectRoot, { id: 'third', objective: '第三项', completedAt: '2026-09-03T00:00:00Z' });

  const result = parseJson(await runActivity(projectRoot, ['search', '--year', '2026', '--limit', '2']));
  assert.equal(result.total, 3);
  assert.deepEqual(result.events.map((event) => event.title), ['第二项', '第三项']);
});

test('a malformed completed_at fails clearly', async (t) => {
  const projectRoot = await createProject(t);
  await seedTask(projectRoot, { completedAt: 'not-a-time' });

  const error = await rejectedCommand(runActivity(projectRoot, ['build']));
  assert.match(error.stderr, /activity catalog error: invalid timestamp/);
});

test('missing and corrupt indexes rebuild from authoritative Tasks', async (t) => {
  const projectRoot = await createProject(t);
  await seedTask(projectRoot);

  const first = parseJson(await runActivity(projectRoot, ['search', '--year', '2026']));
  assert.equal(first.catalog_refreshed, true);

  const indexPath = path.join(projectRoot, '.maestro', 'activity', 'index.json');
  await writeFile(indexPath, '{broken', 'utf8');
  const second = parseJson(await runActivity(projectRoot, ['search', '--year', '2026']));
  assert.equal(second.catalog_refreshed, true);
  assert.equal(second.total, 1);
  const repairedIndex = await readFile(indexPath, 'utf8');
  assert.doesNotThrow(() => JSON.parse(repairedIndex));
});

test('check reports stale after an authoritative Task lifecycle change', async (t) => {
  const projectRoot = await createProject(t);
  const taskPath = await seedTask(projectRoot, { status: 'active', completedAt: null });
  await runActivity(projectRoot, ['build']);
  assert.equal(parseJson(await runActivity(projectRoot, ['check'])).status, 'current');

  await writeFile(taskPath, taskYaml({ status: 'completed' }), 'utf8');
  const error = await rejectedCommand(runActivity(projectRoot, ['check']));
  assert.match(error.stderr, /missing or stale/);
});

test('malformed Task YAML and duplicate Task IDs fail instead of being skipped', async (t) => {
  const malformedRoot = await createProject(t);
  await writeProjectFile(malformedRoot, '.maestro/tasks/broken/task.yaml', 'id: [broken\n');
  const malformed = await rejectedCommand(runActivity(malformedRoot, ['build']));
  assert.match(malformed.stderr, /activity catalog error/);

  const duplicateRoot = await createProject(t);
  await seedTask(duplicateRoot, { id: 'same' });
  await seedTask(duplicateRoot, { id: 'same' }, '.maestro/tasks/archive');
  const duplicate = await rejectedCommand(runActivity(duplicateRoot, ['build']));
  assert.match(duplicate.stderr, /duplicate Task id 'same'/);
});
