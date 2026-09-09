import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Writable } from 'node:stream';

import { recoveryContext, run } from '../adapters/codex/maestro-codex/scripts/session-start.mjs';
import { installLocal } from '../adapters/codex/install-local.mjs';

const pluginSource = fileURLToPath(new URL('../adapters/codex/maestro-codex/', import.meta.url));
const event = (cwd, source = 'compact') => ({ hook_event_name: 'SessionStart', cwd, source });
const metadata = { package: 'maestro-ai-workflow', schema_version: 1, tools: ['codex'] };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'maestro-codex-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function put(root, file, text) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}

async function project(root, config = metadata, { core = true } = {}) {
  await put(root, '.maestro/installation.json', JSON.stringify(config));
  if (core) await put(root, '.agents/skills/maestro/SKILL.md', 'CORE_CONTENT_MUST_NOT_BE_PRELOADED');
}

async function invoke(input) {
  let stdout = '', stderr = '';
  const sink = cb => new Writable({ write(chunk, encoding, done) { cb(chunk.toString()); done(); } });
  await run(Readable.from([input]), sink(s => { stdout += s; }), sink(s => { stderr += s; }));
  return { stdout, stderr };
}

test('Codex restores bounded entry points for each SessionStart source without loading content', async t => {
  const root = await fixture(t);
  await project(root);
  await put(root, '.maestro/memory/manifest.md', 'PRIVATE_MEMORY_MUST_NOT_BE_INJECTED');
  await put(root, '.maestro/memory/index.json', 'untrusted-index-data');
  await mkdir(path.join(root, 'src/nested'), { recursive: true });
  for (const source of ['startup', 'resume', 'clear', 'compact']) {
    const result = await recoveryContext(event(path.join(root, 'src/nested'), source));
    assert.equal(result.hookSpecificOutput.hookEventName, 'SessionStart');
    const context = result.hookSpecificOutput.additionalContext;
    assert.ok(context.length < 4000);
    assert.match(context, /manifest\.md/);
    assert.match(context, /SKILL\.md/);
    assert.doesNotMatch(context, /PRIVATE_MEMORY|CORE_CONTENT|untrusted-index-data/);
    assert.equal(result.continue, undefined);
  }
  assert.deepEqual(await readdir(path.join(root, '.maestro')), ['installation.json', 'memory']);
});

test('Codex maps bounded Workers to native subagents without conflating separate tasks', async t => {
  const root = await fixture(t);
  await project(root);
  const result = await recoveryContext(event(root));
  const context = result.hookSpecificOutput.additionalContext;

  assert.match(context, /bounded Maestro Worker.*Codex-native subagent capability/i);
  assert.match(context, /spawn_agent.*visible/i);
  assert.match(context, /separate user-owned Codex task or conversation.*explicitly requests/i);
  assert.match(context, /tool-facing identifiers.*visible tool schema/i);
  assert.match(context, /task-specific Chinese Worker names.*user-facing text/i);
  assert.match(context, /Old Zhou is the only preset user-facing role/i);
  assert.match(context, /keep routine code search.*inside bounded Workers/i);
});

test('Codex hook stays silent without valid Maestro metadata and for other events', async t => {
  const root = await fixture(t);
  assert.equal(await recoveryContext(event(root)), null);
  assert.deepEqual(await readdir(root), []);
  await project(root, { ...metadata, package: 'other-package' });
  assert.equal(await recoveryContext(event(root)), null);
  await project(root, { ...metadata, schema_version: 2 });
  assert.equal(await recoveryContext(event(root)), null);
  await project(root);
  assert.equal(await recoveryContext({ ...event(root), hook_event_name: 'SubagentStart' }), null);
  assert.equal(await recoveryContext(event(root, 'unknown')), null);
  assert.equal(await recoveryContext(event('relative/path')), null);
});

test('Codex restores cross-host state without a project-local Core or codex tool selection', async t => {
  const root = await fixture(t);
  await project(root, { ...metadata, tools: ['claude'] }, { core: false });
  await put(root, '.maestro/memory/manifest.md', 'SHARED_MEMORY_MUST_NOT_BE_INJECTED');
  await put(root, '.maestro/tasks/current.md', 'SHARED_TASK_MUST_NOT_BE_INJECTED');

  for (const config of [
    { ...metadata, tools: ['claude'] },
    { package: metadata.package, schema_version: metadata.schema_version },
  ]) {
    await put(root, '.maestro/installation.json', JSON.stringify(config));
    const result = await recoveryContext(event(root));
    const context = result.hookSpecificOutput.additionalContext;
    assert.match(context, /host-independent shared project state/);
    assert.match(context, /memory_root/);
    assert.match(context, /task_root/);
    assert.match(context, /manifest\.md/);
    assert.doesNotMatch(context, /SKILL\.md|SHARED_MEMORY|SHARED_TASK/);
  }
});

test('Codex does not cross a nested repository or worktree boundary', async t => {
  const root = await fixture(t);
  await project(root);
  await put(root, 'nested/.git', 'gitdir: /another/worktree');
  await mkdir(path.join(root, 'nested/src'));
  assert.equal(await recoveryContext(event(path.join(root, 'nested/src'))), null);
});

test('Codex does not invent a catalog when no Memory has been persisted', async t => {
  const root = await fixture(t);
  await project(root);
  const result = await recoveryContext(event(root));
  const context = result.hookSpecificOutput.additionalContext;
  assert.doesNotMatch(context, /manifest\.md|index\.json/);
  assert.match(context, /not an active-task selection or a checkpoint/);
  assert.deepEqual(await readdir(path.join(root, '.maestro')), ['installation.json']);
});

test('Codex rejects malformed and oversized input without echoing private data', async t => {
  const root = await fixture(t);
  for (const payload of ['SECRET_INVALID_JSON', 'x'.repeat(65537)]) {
    const result = await invoke(payload);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /skipped/);
    assert.doesNotMatch(result.stderr, /SECRET/);
  }
  await project(root);
  await put(root, '.maestro/installation.json', 'x'.repeat(17000));
  const result = await invoke(JSON.stringify(event(root)));
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /skipped/);
});

test('Codex ignores an external symlinked Core hint but still restores project state', async t => {
  const root = await fixture(t);
  await project(root);
  const core = path.join(root, '.agents/skills/maestro/SKILL.md');
  const outside = await fixture(t);
  await put(outside, 'SKILL.md', 'external');
  await rm(core);
  try { await symlink(path.join(outside, 'SKILL.md'), core); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Symlink privilege unavailable'); throw error; }
  const result = await recoveryContext(event(root));
  assert.ok(result);
  assert.doesNotMatch(result.hookSpecificOutput.additionalContext, /SKILL\.md/);
});

test('shipped hook command runs from an installed plugin path with spaces and shell metacharacters', async t => {
  const root = await fixture(t);
  const source = path.join(root, 'plugin space & unicode 中文');
  await cp(pluginSource, source, { recursive: true });
  const projectRoot = path.join(root, 'project');
  await project(projectRoot);
  const hooks = JSON.parse(await readFile(path.join(source, 'hooks/hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(hooks.hooks), ['SessionStart']);
  const command = hooks.hooks.SessionStart[0].hooks[0].command;
  const stdout = execSync(command, {
    cwd: projectRoot, env: { ...process.env, PLUGIN_ROOT: source },
    input: JSON.stringify(event(projectRoot)), encoding: 'utf8', timeout: 10000,
  });
  assert.equal(JSON.parse(stdout).hookSpecificOutput.hookEventName, 'SessionStart');
});

test('local installer prepares a hooks-only personal source without activation or project writes', async t => {
  const homeDir = await fixture(t);
  const result = await installLocal({ homeDir });
  const catalog = JSON.parse(await readFile(result.marketplace, 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(result.pluginDir, '.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(catalog.name, 'personal');
  assert.equal(result.pluginDir, path.join(homeDir, '.codex/plugins/maestro-codex'));
  assert.equal(catalog.plugins[0].source.path, './.codex/plugins/maestro-codex');
  assert.equal(catalog.plugins[0].policy.installation, 'AVAILABLE');
  assert.equal(manifest.skills, undefined);
  assert.match(manifest.version, /^0\.1\.0\+codex\.[a-f0-9]{16}$/);
  assert.ok(!(await readdir(homeDir)).includes('plugins'));
  assert.ok(!(await readdir(homeDir)).includes('.maestro'));
});

test('local reinstall preserves catalog ordering, policy, and unrelated plugin files', async t => {
  const homeDir = await fixture(t);
  const catalog = {
    name: 'my-personal', interface: { displayName: 'My tools' },
    plugins: [{ name: 'other-tool', source: { source: 'local', path: './plugins/other-tool' } }],
  };
  await put(homeDir, '.agents/plugins/marketplace.json', JSON.stringify(catalog));
  const first = await installLocal({ homeDir });
  const saved = JSON.parse(await readFile(first.marketplace, 'utf8'));
  saved.plugins[1].policy.installation = 'NOT_AVAILABLE';
  await writeFile(first.marketplace, JSON.stringify(saved));
  await put(first.pluginDir, 'my-notes.md', 'keep');
  const second = await installLocal({ homeDir });
  assert.equal(first.version, second.version);
  assert.equal(await readFile(first.marketplace, 'utf8'), JSON.stringify(saved));
  assert.equal(await readFile(path.join(first.pluginDir, 'my-notes.md'), 'utf8'), 'keep');
});

test('changed plugin source gets a fresh version for reinstall', async t => {
  const homeDir = await fixture(t);
  const sourceDir = path.join(await fixture(t), 'maestro-codex');
  await cp(pluginSource, sourceDir, { recursive: true });
  const first = await installLocal({ homeDir, sourceDir });
  await put(sourceDir, 'scripts/session-start.mjs', '// new revision');
  const second = await installLocal({ homeDir, sourceDir });
  assert.notEqual(first.version, second.version);
});

test('local installer refuses a foreign destination or conflicting marketplace entry', async t => {
  for (const scenario of ['directory', 'catalog']) {
    const homeDir = await fixture(t);
    if (scenario === 'directory') {
      await put(homeDir, '.codex/plugins/maestro-codex/custom.txt', 'keep');
    } else {
      await put(homeDir, '.agents/plugins/marketplace.json', JSON.stringify({
        name: 'personal', plugins: [{ name: 'maestro-codex', source: { source: 'local', path: './elsewhere' } }],
      }));
    }
    await assert.rejects(installLocal({ homeDir }), /not managed|points elsewhere/);
    if (scenario === 'directory') {
      assert.equal(await readFile(path.join(homeDir, '.codex/plugins/maestro-codex/custom.txt'), 'utf8'), 'keep');
    }
  }
});

test('local installer rejects a symlinked Codex directory instead of writing outside home', async t => {
  const homeDir = await fixture(t);
  const outside = await fixture(t);
  try { await symlink(outside, path.join(homeDir, '.codex'), 'dir'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Symlink privilege unavailable'); throw error; }
  await assert.rejects(installLocal({ homeDir }), /real directory/);
  assert.deepEqual(await readdir(outside), []);
});

test('local installer preserves invalid marketplace contents and refuses an occupied lock', async t => {
  const homeDir = await fixture(t);
  await put(homeDir, '.agents/plugins/marketplace.json', 'invalid');
  await assert.rejects(installLocal({ homeDir }));
  assert.equal(await readFile(path.join(homeDir, '.agents/plugins/marketplace.json'), 'utf8'), 'invalid');
  await put(homeDir, '.agents/plugins/.maestro-codex-install.lock', 'another installer');
  await assert.rejects(installLocal({ homeDir }), { code: 'EEXIST' });
  assert.equal(await readFile(path.join(homeDir, '.agents/plugins/.maestro-codex-install.lock'), 'utf8'), 'another installer');
});
