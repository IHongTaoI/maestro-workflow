#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateJsonSchema } from './schema-validator.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const defaultCasesPath = path.join(repositoryRoot, 'maestro', 'evals', 'cases');
const defaultObservationsPath = path.join(
  repositoryRoot,
  'maestro',
  'evals',
  'fixtures',
  'observations.json',
);
const observationSchema = JSON.parse(
  await readFile(path.join(import.meta.dirname, 'observation.schema.json'), 'utf8'),
);

function usage() {
  return `Usage: node maestro/evals/run.mjs [options]

Options:
  --cases <directory>       Eval case directory (default: maestro/evals/cases)
  --observations <file>     Replay normalized observations (default fixture when no adapter is set)
  --adapter <module>        ES module exporting runCase(request)
  --judge-adapter <module>  ES module exporting judgeCase(request)
  --case <id>               Run one case only
  --json                    Emit a machine-readable report
  --help                    Show this help

An execution adapter receives the current Skill files and one case, and returns a normalized
observation. A judge adapter receives the same Skill bundle plus the case and observation.`;
}

function failUsage(message) {
  throw Object.assign(new Error(message), { exitCode: 2 });
}

function parseArguments(argv) {
  const options = {
    casesPath: defaultCasesPath,
    observationsPath: null,
    adapterPath: null,
    judgeAdapterPath: null,
    caseId: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (['--cases', '--observations', '--adapter', '--judge-adapter', '--case'].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        failUsage(`${argument} requires a value`);
      }
      index += 1;
      if (argument === '--cases') options.casesPath = path.resolve(value);
      if (argument === '--observations') options.observationsPath = path.resolve(value);
      if (argument === '--adapter') options.adapterPath = path.resolve(value);
      if (argument === '--judge-adapter') options.judgeAdapterPath = path.resolve(value);
      if (argument === '--case') options.caseId = value;
      continue;
    }
    failUsage(`Unknown option: ${argument}`);
  }

  if (options.adapterPath && options.observationsPath) {
    failUsage('Use either --adapter or --observations, not both');
  }
  if (!options.adapterPath && !options.observationsPath) {
    options.observationsPath = defaultObservationsPath;
  }
  return options;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read JSON ${path.relative(repositoryRoot, filePath)}: ${error.message}`);
  }
}

function validateCaseShape(caseDefinition, filePath) {
  const required = ['schema_version', 'id', 'name', 'category', 'setup', 'turns', 'expect', 'must_not'];
  for (const field of required) {
    if (!(field in caseDefinition)) {
      throw new Error(`${path.relative(repositoryRoot, filePath)} is missing '${field}'`);
    }
  }
  if (caseDefinition.schema_version !== 1) {
    throw new Error(`${caseDefinition.id ?? filePath} has unsupported schema_version`);
  }
  if (!Array.isArray(caseDefinition.turns) || caseDefinition.turns.length === 0) {
    throw new Error(`${caseDefinition.id} must contain at least one turn`);
  }
  if (!Array.isArray(caseDefinition.expect) || caseDefinition.expect.length === 0) {
    throw new Error(`${caseDefinition.id} must contain at least one deterministic expectation`);
  }
  if (!Array.isArray(caseDefinition.must_not)) {
    throw new Error(`${caseDefinition.id} must contain must_not assertions`);
  }
}

async function loadCases(casesPath, caseId) {
  const entries = await readdir(casesPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(casesPath, entry.name))
    .sort();
  const cases = [];
  const ids = new Set();
  for (const filePath of files) {
    const caseDefinition = await readJson(filePath);
    validateCaseShape(caseDefinition, filePath);
    if (ids.has(caseDefinition.id)) {
      throw new Error(`Duplicate eval case id: ${caseDefinition.id}`);
    }
    ids.add(caseDefinition.id);
    if (!caseId || caseDefinition.id === caseId) {
      cases.push(caseDefinition);
    }
  }
  if (caseId && cases.length === 0) {
    throw new Error(`Unknown eval case: ${caseId}`);
  }
  if (cases.length === 0) {
    throw new Error(`No eval cases found in ${casesPath}`);
  }
  return cases;
}

async function listFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(entryPath));
    if (entry.isFile()) result.push(entryPath);
  }
  return result;
}

async function loadSkillBundle() {
  const skillRoot = path.join(repositoryRoot, 'maestro');
  const paths = [path.join(skillRoot, 'SKILL.md'), ...await listFiles(path.join(skillRoot, 'references'))];
  const files = {};
  for (const filePath of paths.sort()) {
    files[path.relative(skillRoot, filePath).replaceAll(path.sep, '/')] = await readFile(filePath, 'utf8');
  }
  return { root: skillRoot, files };
}

async function loadAdapter(modulePath, exportName) {
  const module = await import(pathToFileURL(modulePath).href);
  if (typeof module[exportName] !== 'function') {
    throw new Error(`${modulePath} must export async function ${exportName}(request)`);
  }
  return module[exportName];
}

function decodePointerSegment(segment) {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function resolvePointer(value, pointer) {
  if (pointer === '') return { exists: true, value };
  if (!pointer.startsWith('/')) return { exists: false, value: undefined };
  let current = value;
  for (const rawSegment of pointer.slice(1).split('/')) {
    const segment = decodePointerSegment(rawSegment);
    if (current === null || typeof current !== 'object' || !(segment in current)) {
      return { exists: false, value: undefined };
    }
    current = current[segment];
  }
  return { exists: true, value: current };
}

function assertionMatches(assertion, observation) {
  const resolved = resolvePointer(observation, assertion.path);
  if (assertion.operator === 'exists') return resolved.exists === assertion.value;
  if (!resolved.exists) return false;
  if (assertion.operator === 'equals') return isDeepStrictEqual(resolved.value, assertion.value);
  if (assertion.operator === 'contains') {
    if (Array.isArray(resolved.value)) {
      return resolved.value.some((item) => isDeepStrictEqual(item, assertion.value));
    }
    return typeof resolved.value === 'string' && typeof assertion.value === 'string'
      && resolved.value.includes(assertion.value);
  }
  if (assertion.operator === 'length_equals') return resolved.value?.length === assertion.value;
  if (assertion.operator === 'length_lte') {
    return typeof resolved.value?.length === 'number' && resolved.value.length <= assertion.value;
  }
  throw new Error(`Unsupported assertion operator: ${assertion.operator}`);
}

function formatAssertion(assertion) {
  return `${assertion.path} ${assertion.operator} ${JSON.stringify(assertion.value)}`;
}

function evaluateCase(caseDefinition, observation) {
  const failures = validateJsonSchema(observationSchema, observation)
    .map((error) => `observation schema: ${error}`);
  if (failures.length > 0) return failures;
  if (observation.case_id !== caseDefinition.id) {
    failures.push(`observation case_id is '${observation.case_id}', expected '${caseDefinition.id}'`);
  }
  for (const assertion of caseDefinition.expect) {
    if (!assertionMatches(assertion, observation)) {
      failures.push(`EXPECT failed: ${formatAssertion(assertion)}`);
    }
  }
  for (const assertion of caseDefinition.must_not) {
    if (assertionMatches(assertion, observation)) {
      failures.push(`MUST_NOT matched: ${formatAssertion(assertion)}`);
    }
  }
  for (const judge of caseDefinition.llm_judges ?? []) {
    const judgments = observation.judgments.filter((candidate) => candidate.id === judge.id);
    if (judgments.length === 0) failures.push(`missing LLM judgment '${judge.id}'`);
    else if (judgments.length > 1) failures.push(`duplicate LLM judgment '${judge.id}'`);
    else if (judgments[0].passed !== true) failures.push(`LLM judgment failed: ${judge.id}`);
  }
  const expectedJudgeIds = new Set((caseDefinition.llm_judges ?? []).map((judge) => judge.id));
  for (const judgment of observation.judgments) {
    if (!expectedJudgeIds.has(judgment.id)) failures.push(`unexpected LLM judgment '${judgment.id}'`);
  }
  return failures;
}

async function loadObservationMap(observationsPath) {
  const fixture = await readJson(observationsPath);
  if (fixture.schema_version !== 1 || !Array.isArray(fixture.observations)) {
    throw new Error('Observation file must contain schema_version=1 and an observations array');
  }
  const observations = new Map();
  for (const observation of fixture.observations) {
    if (observations.has(observation.case_id)) {
      throw new Error(`Duplicate observation for case: ${observation.case_id}`);
    }
    observations.set(observation.case_id, observation);
  }
  return observations;
}

async function run(options) {
  const cases = await loadCases(options.casesPath, options.caseId);
  const observationMap = options.adapterPath
    ? null
    : await loadObservationMap(options.observationsPath);
  const runCase = options.adapterPath ? await loadAdapter(options.adapterPath, 'runCase') : null;
  const judgeCase = options.judgeAdapterPath
    ? await loadAdapter(options.judgeAdapterPath, 'judgeCase')
    : null;
  const skill = (runCase || judgeCase) ? await loadSkillBundle() : null;
  const results = [];

  for (const caseDefinition of cases) {
    let observation;
    if (runCase) {
      observation = await runCase({
        case: caseDefinition,
        repositoryRoot,
        skill,
      });
    } else {
      observation = observationMap.get(caseDefinition.id);
      if (!observation) {
        results.push({ id: caseDefinition.id, name: caseDefinition.name, passed: false, failures: ['missing observation'] });
        continue;
      }
    }

    if (judgeCase && (caseDefinition.llm_judges?.length ?? 0) > 0) {
      observation = { ...observation, judgments: await judgeCase({
        case: caseDefinition,
        observation,
        repositoryRoot,
        skill,
      }) };
    }
    const failures = evaluateCase(caseDefinition, observation);
    results.push({
      id: caseDefinition.id,
      name: caseDefinition.name,
      passed: failures.length === 0,
      failures,
    });
  }

  const passed = results.filter((result) => result.passed).length;
  const report = {
    schema_version: 1,
    mode: runCase ? 'live-adapter' : 'observation-replay',
    passed,
    failed: results.length - passed,
    total: results.length,
    results,
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const result of results) {
      process.stdout.write(`${result.passed ? 'PASS' : 'FAIL'} ${result.id} - ${result.name}\n`);
      for (const failure of result.failures) process.stdout.write(`  ${failure}\n`);
    }
    process.stdout.write(`\n${passed}/${results.length} eval cases passed (${report.mode}).\n`);
  }
  return report.failed === 0 ? 0 : 1;
}

try {
  const exitCode = await run(parseArguments(process.argv.slice(2)));
  process.exitCode = exitCode;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.exitCode ?? 1;
}
