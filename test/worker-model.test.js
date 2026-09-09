import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const json = async path => JSON.parse(await readFile(path, 'utf8'));

test('new work has no built-in execution Workers and uses capability practices', async () => {
  const builtinWorkers = await json('maestro/references/workers/builtin-registry.json');
  const instructions = await json('maestro/references/instructions/builtin-registry.json');
  const projectWorkers = await json(
    'maestro/references/scenarios/schema-fixtures/worker-registry-valid.json',
  );

  assert.deepEqual(builtinWorkers.workers, []);
  assert.deepEqual(builtinWorkers.aliases, {});

  const knownRefs = new Map(instructions.instructions.map(item => [item.ref, item]));
  assert.ok([...knownRefs.keys()].some(ref => ref.startsWith('practice:')));
  assert.ok([...knownRefs.keys()].some(ref => ref.startsWith('role:')));

  for (const worker of projectWorkers.workers) {
    assert.ok(worker.instructions.required.includes('contract:handoff'));
    assert.ok(worker.instructions.required.includes('policy:safety-boundary'));
    assert.ok(worker.instructions.required.some(ref => ref.startsWith('practice:')));
    assert.ok(worker.instructions.required.every(ref => !ref.startsWith('role:')));
  }

  for (const instruction of instructions.instructions) {
    for (const source of instruction.source_paths) {
      await access(`maestro/${source}`);
    }
  }
});

test('generated Worker examples use task-specific Chinese display names', async () => {
  for (const fixture of [
    'worker-temporary-valid.json',
    'worker-temporary-memory-valid.json',
    'worker-session-valid.json',
  ]) {
    const worker = await json(`maestro/references/scenarios/schema-fixtures/${fixture}`);
    assert.match(worker.name, /[\p{Script=Han}]/u);
    assert.match(worker.id, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
    assert.ok(worker.instructions.required.some(ref => ref.startsWith('practice:')));
  }
});

test('Maestro entry point exposes only Old Zhou while legacy role files stay unlinked', async () => {
  const skill = await readFile('maestro/SKILL.md', 'utf8');
  assert.doesNotMatch(skill, /\]\(references\/roles\//);
  assert.match(skill, /Old Zhou.*only preset user-facing role/);

  for (const role of [
    'architect',
    'coder',
    'delivery',
    'laborer',
    'memory-merger',
    'orchestrator',
    'test-designer',
    'test-runner',
    'tpm',
  ]) {
    await access(`maestro/references/roles/${role}.md`);
  }
});
