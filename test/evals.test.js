import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import {
  createCodexAdapter,
  buildCasePrompt,
  createCodexOutputSchema,
} from '../maestro/evals/adapters/codex-cli.mjs';
import { validateJsonSchema } from '../maestro/evals/schema-validator.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const runnerPath = path.join(repositoryRoot, 'maestro', 'evals', 'run.mjs');
const observationsPath = path.join(repositoryRoot, 'maestro', 'evals', 'fixtures', 'observations.json');
const observationSchemaPath = path.join(repositoryRoot, 'maestro', 'evals', 'observation.schema.json');

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
  assert.equal(report.total, 30);
  assert.equal(report.passed, 30);
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
  assert.match(failure.stdout, /observation schema: \/task_created: is required/);
});

test('observation validation reuses the full JSON Schema', async () => {
  const schema = JSON.parse(await readFile(observationSchemaPath, 'utf8'));
  const observations = JSON.parse(await readFile(observationsPath, 'utf8'));
  const base = observations.observations[0];
  const invalidMode = structuredClone(base);
  invalidMode.mode = 'planning';
  const invalidWorker = structuredClone(base);
  invalidWorker.workers[0].kind = 'invented';
  const duplicatePermission = structuredClone(base);
  duplicatePermission.workers[0].permissions.push('read-project');
  const additionalProperty = structuredClone(base);
  additionalProperty.workers[0].authority = 'unbounded';
  const duplicateReference = structuredClone(base);
  duplicateReference.references_loaded = ['references/memory.md', 'references/memory.md'];

  assert.deepEqual(validateJsonSchema(schema, base), []);
  assert.match(validateJsonSchema(schema, invalidMode).join('\n'), /\/mode: must be one of/);
  assert.match(validateJsonSchema(schema, invalidWorker).join('\n'), /\/workers\/0\/kind: must be one of/);
  assert.match(validateJsonSchema(schema, duplicatePermission).join('\n'), /\/workers\/0\/permissions\/1: must be unique/);
  assert.match(validateJsonSchema(schema, additionalProperty).join('\n'), /\/workers\/0\/authority: additional property is not allowed/);
  assert.match(validateJsonSchema(schema, duplicateReference).join('\n'), /\/references_loaded\/1: must be unique/);
});

test('Codex schema projection removes only unsupported structured-output constraints', async () => {
  const schema = JSON.parse(await readFile(observationSchemaPath, 'utf8'));
  const projected = createCodexOutputSchema(schema);
  const permissions = projected.properties.workers.items.properties.permissions;

  assert.equal(permissions.uniqueItems, undefined);
  assert.equal(projected.properties.case_id.minLength, undefined);
  assert.equal(projected.properties.mode.enum.includes('one-off'), true);
  assert.equal(projected.properties.workers.items.additionalProperties, false);
  assert.equal(schema.properties.workers.items.properties.permissions.uniqueItems, true);
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

test('Codex reference adapter materializes the current Skill and hides expectations', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'maestro-codex-adapter-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const observations = JSON.parse(await readFile(observationsPath, 'utf8'));
  const observation = observations.observations.find(
    (candidate) => candidate.case_id === 'performance-investigation-stays-temporary',
  );
  const caseDefinition = JSON.parse(await readFile(
    path.join(repositoryRoot, 'maestro', 'evals', 'cases', '01-performance-investigation.json'),
    'utf8',
  ));
  const fakeCliPath = path.join(temporaryRoot, 'fake-codex.mjs');
  await writeFile(fakeCliPath, `
    import fs from 'node:fs';
    import path from 'node:path';
    let prompt = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) prompt += chunk;
    if (!fs.existsSync(path.join(process.cwd(), '.agents', 'skills', 'maestro', 'SKILL.md'))) {
      process.stderr.write('Skill was not materialized');
      process.exit(1);
    }
    if (prompt.includes('"expect"') || prompt.includes('"must_not"')) {
      process.stderr.write('Expected answers leaked into prompt');
      process.exit(1);
    }
    const schemaIndex = process.argv.indexOf('--output-schema');
    const outputSchema = JSON.parse(fs.readFileSync(process.argv[schemaIndex + 1], 'utf8'));
    if (JSON.stringify(outputSchema).includes('"uniqueItems"')) {
      process.stderr.write('Unsupported JSON Schema keyword reached Codex');
      process.exit(1);
    }
    const outputIndex = process.argv.indexOf('--output-last-message');
    fs.writeFileSync(process.argv[outputIndex + 1], ${JSON.stringify(JSON.stringify(observation))});
  `);
  const adapter = createCodexAdapter({
    command: process.execPath,
    commandArgs: [fakeCliPath],
    timeoutMs: 10_000,
  });

  const result = await adapter.runCase({
    case: caseDefinition,
    skill: { files: { 'SKILL.md': '# Maestro', 'references/coordination.md': '# Coordination' } },
  });

  assert.equal(result.case_id, caseDefinition.id);
  assert.doesNotMatch(buildCasePrompt(caseDefinition), /"expect"|"must_not"/);
});
