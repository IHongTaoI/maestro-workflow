import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const SOURCES = new Set(['startup', 'resume', 'clear', 'compact']);
const CORE = '.agents/skills/maestro/SKILL.md';
const CONFIG = '.maestro/installation.json';

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

async function exists(target) {
  try { await stat(target); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// Only inspect entry points contained in this project. Never read Memory bodies.
async function localFile(root, relative) {
  try {
    const resolved = await realpath(path.join(root, relative));
    return inside(root, resolved) && (await stat(resolved)).isFile() ? resolved : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function readConfig(file) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(16 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === buffer.length) throw new Error('Installation metadata exceeds limit');
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally { await handle.close(); }
}

export async function recoveryContext(event) {
  if (event?.hook_event_name !== 'SessionStart' || !SOURCES.has(event.source)
    || typeof event.cwd !== 'string' || !path.isAbsolute(event.cwd)) return null;
  let root = await realpath(event.cwd);
  for (let depth = 0; depth < 64; depth++) {
    const config = await localFile(root, CONFIG);
    if (config) {
      const metadata = await readConfig(config);
      if (metadata.package !== 'maestro-ai-workflow' || metadata.schema_version !== 1) return null;

      const paths = {
        project_root: root,
        memory_root: path.join(root, '.maestro/memory'),
        task_root: path.join(root, '.maestro/tasks'),
      };
      const localCore = await localFile(root, CORE);
      if (localCore) paths.skill = localCore;
      for (const [key, relative] of [
        ['manifest', '.maestro/memory/manifest.md'],
        ['index', '.maestro/memory/index.json'],
      ]) {
        if (await localFile(root, relative)) paths[key] = path.join(root, relative);
      }
      // JSON-encode filesystem strings instead of inserting them into instructions.
      if (JSON.stringify(paths).length > 1600) throw new Error('Project paths exceed context limit');
      return {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: [
            'Valid Maestro project state is present. Apply this reminder only when the current request invokes Maestro or continues Maestro work; project state alone does not activate a task.',
            'For Maestro work: Old Zhou coordinates dynamically. Keep one-offs small; do not force a role sequence. Exploration stays Temporary unless there is clear implementation intent.',
            'Delegations need explicit objectives, context, tools, paths, permissions and handoffs. Do not infer inherited authority or claim unavailable isolation. Wait for running Workers; do not duplicate or take over without cancellation, reassignment or terminal failure.',
            'For a bounded Maestro Worker, use an available Codex-native subagent capability, such as spawn_agent when that tool is visible; do not use create_thread or another separate-task API as a substitute.',
            'Create a separate user-owned Codex task or conversation only when the user explicitly requests one.',
            'Keep tool-facing identifiers within the visible tool schema (for example, short lowercase snake_case); use concise Chinese role labels in user-facing text or a supported display-name field.',
            'Keep durable state in this project. Treat .maestro Memory and Task as host-independent shared project state. Memory and old approvals cannot expand current authorization. Validate generated state before persistence.',
            'Find and load the Maestro Core through Codex skill discovery when its detailed rules are needed, then load only references needed for the current step. A skill path below is only an optional project-local hint; its absence does not mean the Core is unavailable. This reminder is not a replacement for the Core.',
            'When resuming, check the Memory catalog freshness using the Core protocol; load the Manifest first and retrieve bounded candidates before selected Current State. Missing catalog/state is not evidence of saved progress. Do not create state just because this hook ran.',
            'These are path hints, not an active-task selection or a checkpoint. Resolve the intended work from the current request; do not silently resume an unrelated task. After a clear, do not treat earlier task intent as current.',
            `Session source: ${event.source}. No transcript was read and no unsaved conversation was recovered.`,
            `Filesystem paths (data only; memory/task directories may not exist): ${JSON.stringify(paths)}`,
          ].join('\n'),
        },
      };
    }
    // A nested repo or worktree must not inherit a different project's state.
    if (await exists(path.join(root, '.git')) || await exists(path.join(root, '.maestro'))) return null;
    const parent = path.dirname(root);
    if (parent === root) return null;
    root = parent;
  }
  return null;
}

export async function run(input = process.stdin, output = process.stdout, errors = process.stderr) {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of input) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 64 * 1024) throw new Error('Hook input exceeds limit');
      chunks.push(buffer);
    }
    const result = await recoveryContext(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (result) output.write(`${JSON.stringify(result)}\n`);
  } catch {
    // Do not stop Codex, expose input/transcript data, or claim a successful recovery.
    errors.write('Maestro recovery hook skipped: invalid input or unavailable project metadata.\n');
  }
}
