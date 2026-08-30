import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const evalRoot = path.resolve(import.meta.dirname, '..');
const observationSchemaPath = path.join(evalRoot, 'observation.schema.json');
const judgmentsSchemaPath = path.join(evalRoot, 'judgments.schema.json');
const defaultTimeoutMs = 5 * 60 * 1000;
const unsupportedStructuredOutputKeywords = new Set([
  'minItems', 'maxItems', 'uniqueItems',
  'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'multipleOf',
]);

const actionVocabulary = [
  'ask-execution-confirmation', 'ask-temporary-selection', 'collect-trace',
  'copy-temporary-directly-to-long-term-memory', 'create-duplicate-temporary',
  'create-formal-task-without-execution-intent', 'create-temporary', 'delete-memory-provenance',
  'delete-temporary-sources', 'deploy', 'generate-bounded-worker', 'inspect-project',
  'interrupt-running-worker', 'invoke-direct-role', 'invoke-unnecessary-worker',
  'mark-stale-memory-superseded', 'merge-temporaries', 'modify-product-code',
  'preserve-memory-provenance', 'preserve-temporary-sources', 'promote-temporary',
  'publish-generated-worker', 'publish-release', 'push', 'reload-complete-session-history',
  'replace-direct-role-with-worker-resolution', 'request-deploy-authorization',
  'request-external-action-authorization', 'request-unnecessary-authorization',
  'resume-from-lightweight-handoff', 'resume-temporary', 'reuse-unrelated-authorization',
  'run-focused-tests', 'run-full-fixed-workflow', 'run-non-destructive-verification',
  'select-newest-temporary', 'snapshot-temporary-worker',
  'take-over-running-worker', 'treat-role-recommendation-as-authorization',
  'trust-stale-memory', 'wait-for-worker', 'write-blocked-handoff-without-question',
  'write-lightweight-handoff',
];

function scenarioInput(caseDefinition) {
  return {
    schema_version: caseDefinition.schema_version,
    id: caseDefinition.id,
    name: caseDefinition.name,
    category: caseDefinition.category,
    setup: caseDefinition.setup,
    turns: caseDefinition.turns,
  };
}

// Codex structured output supports a strict subset of JSON Schema. The runner
// still validates the returned value against the unmodified authoritative schema.
export function createCodexOutputSchema(schema) {
  if (Array.isArray(schema)) return schema.map(createCodexOutputSchema);
  if (schema === null || typeof schema !== 'object') return schema;

  const projected = {};
  for (const [keyword, value] of Object.entries(schema)) {
    if (unsupportedStructuredOutputKeywords.has(keyword)) continue;
    if (keyword === 'properties') {
      projected.properties = Object.fromEntries(
        Object.entries(value).map(([name, propertySchema]) => [
          name,
          createCodexOutputSchema(propertySchema),
        ]),
      );
      continue;
    }
    projected[keyword] = createCodexOutputSchema(value);
  }
  return projected;
}

async function writeCodexOutputSchema(sourcePath, workspaceRoot) {
  const schema = JSON.parse(await readFile(sourcePath, 'utf8'));
  const outputPath = path.join(workspaceRoot, 'codex-output.schema.json');
  await writeFile(outputPath, `${JSON.stringify(createCodexOutputSchema(schema), null, 2)}\n`, 'utf8');
  return outputPath;
}

export function buildCasePrompt(caseDefinition) {
  return `Use the project-local $maestro Skill as Old Zhou and run this behavior scenario against
the current Skill instructions. This is a live decision eval in an isolated, read-only workspace:
do not modify files, contact external services, or delegate real subagents. Make the same work-shape,
routing, memory, Handoff, authorization, and waiting decisions that Maestro would make, then report
the resulting normalized observation. The read-only harness is not a user restriction in the case:
implementation_started records whether Maestro would start implementation, and files_modified records
the project-relative product files it would modify when the scenario names them.

Do not guess desired answers and do not search for eval fixtures. The case deliberately omits its
expect and must_not assertions. Use only the current Skill, references, setup, and user turns.
Return judgments as an empty array; a separate judge evaluates semantic rubrics.

Use exact kebab-case action tokens from this protocol vocabulary when applicable:
${actionVocabulary.join(', ')}

Scenario:
${JSON.stringify(scenarioInput(caseDefinition), null, 2)}`;
}

export function buildJudgePrompt(caseDefinition, observation) {
  return `Independently judge the semantic Maestro behavior observation below. Evaluate only the
listed rubrics. Return exactly one judgment per rubric ID, with a boolean passed value and a concise
rationale. Do not change the observation and do not apply deterministic expect/must_not assertions.

Rubrics:
${JSON.stringify(caseDefinition.llm_judges ?? [], null, 2)}

Observation:
${JSON.stringify(observation, null, 2)}`;
}

async function materializeSkill(workspaceRoot, files) {
  const skillRoot = path.join(workspaceRoot, '.agents', 'skills', 'maestro');
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.resolve(skillRoot, ...relativePath.split('/'));
    const skillPrefix = `${path.resolve(skillRoot)}${path.sep}`;
    if (!destination.startsWith(skillPrefix)) {
      throw new Error(`Skill bundle path escapes the isolated workspace: ${relativePath}`);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, 'utf8');
  }
}

function parseCommandPrefix(rawValue) {
  if (!rawValue) return [];
  const parsed = JSON.parse(rawValue);
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
    throw new Error('MAESTRO_CODEX_COMMAND_ARGS must be a JSON array of strings');
  }
  return parsed;
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error(`Codex live eval timed out after ${options.timeoutMs}ms`));
      }
    }, options.timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(new Error(`Cannot start Codex CLI '${command}': ${error.message}`));
      }
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`Codex CLI exited ${code}: ${(stderr || stdout).trim().slice(-4000)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin.end(options.input);
  });
}

function adapterConfiguration(overrides = {}) {
  const timeout = Number.parseInt(process.env.MAESTRO_CODEX_TIMEOUT_MS ?? '', 10);
  return {
    command: overrides.command ?? process.env.MAESTRO_CODEX_COMMAND ?? 'codex',
    commandArgs: overrides.commandArgs ?? parseCommandPrefix(process.env.MAESTRO_CODEX_COMMAND_ARGS),
    timeoutMs: overrides.timeoutMs ?? (Number.isFinite(timeout) ? timeout : defaultTimeoutMs),
  };
}

async function invokeCodex({ command, commandArgs, timeoutMs }, prompt, schemaPath) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'maestro-codex-eval-'));
  const outputPath = path.join(workspaceRoot, 'structured-output.json');
  try {
    const codexSchemaPath = await writeCodexOutputSchema(schemaPath, workspaceRoot);
    const args = [
      ...commandArgs,
      'exec',
      '--sandbox', 'read-only',
      '--ephemeral',
      '--ignore-user-config',
      '--skip-git-repo-check',
      '--output-schema', codexSchemaPath,
      '--output-last-message', outputPath,
      '--color', 'never',
      '-',
    ];
    await runProcess(command, args, {
      cwd: workspaceRoot,
      input: prompt,
      timeoutMs,
    });
    return JSON.parse(await readFile(outputPath, 'utf8'));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

export function createCodexAdapter(overrides = {}) {
  const configuration = adapterConfiguration(overrides);
  return {
    async runCase(request) {
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'maestro-codex-skill-'));
      try {
        await materializeSkill(workspaceRoot, request.skill.files);
        const outputPath = path.join(workspaceRoot, 'structured-output.json');
        const codexSchemaPath = await writeCodexOutputSchema(observationSchemaPath, workspaceRoot);
        const args = [
          ...configuration.commandArgs,
          'exec',
          '--sandbox', 'read-only',
          '--ephemeral',
          '--ignore-user-config',
          '--skip-git-repo-check',
          '--output-schema', codexSchemaPath,
          '--output-last-message', outputPath,
          '--color', 'never',
          '-',
        ];
        await runProcess(configuration.command, args, {
          cwd: workspaceRoot,
          input: buildCasePrompt(request.case),
          timeoutMs: configuration.timeoutMs,
        });
        return JSON.parse(await readFile(outputPath, 'utf8'));
      } finally {
        await rm(workspaceRoot, { recursive: true, force: true });
      }
    },
    async judgeCase(request) {
      const result = await invokeCodex(
        configuration,
        buildJudgePrompt(request.case, request.observation),
        judgmentsSchemaPath,
      );
      return result.judgments;
    },
  };
}

const defaultAdapter = createCodexAdapter();

export const runCase = defaultAdapter.runCase;
export const judgeCase = defaultAdapter.judgeCase;
