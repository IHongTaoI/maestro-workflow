import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const runnerPath = path.join(repositoryRoot, 'maestro', 'evals', 'run.mjs');
const observationsPath = path.join(repositoryRoot, 'maestro', 'evals', 'fixtures', 'observations.json');

function runEvals(args) {
  return execFileAsync(process.execPath, [runnerPath, ...args], {
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

test('replays all checked-in Agent behavior cases', async () => {
  const result = await runEvals(['--observations', observationsPath, '--json']);
  const report = JSON.parse(result.stdout);

  assert.equal(report.mode, 'observation-replay');
  assert.equal(report.total, 20);
  assert.equal(report.passed, 20);
  assert.equal(report.failed, 0);
});

test('supports selecting one eval case', async () => {
  const result = await runEvals([
    '--observations', observationsPath,
    '--case', 'performance-investigation-stays-temporary',
  ]);

  assert.match(result.stdout, /PASS performance-investigation-stays-temporary/);
  assert.match(result.stdout, /1\/1 eval cases passed/);
});

test('fails when a forbidden behavior is observed', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'maestro-eval-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const observations = JSON.parse(await readFile(observationsPath, 'utf8'));
  const observation = observations.observations.find(
    (candidate) => candidate.case_id === 'performance-investigation-stays-temporary',
  );
  observation.actions.push('modify-product-code');
  const failingPath = path.join(temporaryRoot, 'observations.json');
  await writeFile(failingPath, JSON.stringify({ schema_version: 1, observations: [observation] }));

  const failure = await rejectedCommand(runEvals([
    '--observations', failingPath,
    '--case', 'performance-investigation-stays-temporary',
  ]));

  assert.equal(failure.code, 1);
  assert.match(failure.stdout, /MUST_NOT matched/);
});

test('rejects a malformed normalized observation', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'maestro-eval-shape-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const malformedPath = path.join(temporaryRoot, 'observations.json');
  await writeFile(malformedPath, JSON.stringify({
    schema_version: 1,
    observations: [{ case_id: 'performance-investigation-stays-temporary' }],
  }));

  const failure = await rejectedCommand(runEvals([
    '--observations', malformedPath,
    '--case', 'performance-investigation-stays-temporary',
  ]));

  assert.equal(failure.code, 1);
  assert.match(failure.stdout, /observation.task_created must be a boolean/);
});

test('live adapter receives the current Skill bundle', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'maestro-eval-adapter-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const observations = JSON.parse(await readFile(observationsPath, 'utf8'));
  const observation = observations.observations.find(
    (candidate) => candidate.case_id === 'performance-investigation-stays-temporary',
  );
  const adapterPath = path.join(temporaryRoot, 'adapter.mjs');
  await writeFile(adapterPath, `
    export async function runCase(request) {
      if (!request.skill.files['SKILL.md'].includes('Decide the work shape')) {
        throw new Error('current Skill was not provided');
      }
      return ${JSON.stringify(observation)};
    }
  `);

  const result = await runEvals([
    '--adapter', adapterPath,
    '--case', 'performance-investigation-stays-temporary',
    '--json',
  ]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.mode, 'live-adapter');
  assert.equal(report.passed, 1);
});
