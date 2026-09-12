import { open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
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

async function hasAuthoritativeSources(root) {
  try {
    const taskDir = path.join(root, '.maestro/tasks');
    const entries = await readdir(taskDir);
    if (entries.some(e => e !== 'archive' && !e.startsWith('.'))) return true;
  } catch {}
  try {
    const tempDir = path.join(root, '.maestro/memory/temporary/active');
    const entries = await readdir(tempDir);
    if (entries.some(e => !e.startsWith('.'))) return true;
  } catch {}
  try {
    const ltDir = path.join(root, '.maestro/memory/long-term/entries');
    const entries = await readdir(ltDir);
    if (entries.some(e => e.endsWith('.md'))) return true;
  } catch {}
  try {
    if (await exists(path.join(root, '.maestro/memory/long-term/current.md'))) return true;
  } catch {}
  try {
    if (await exists(path.join(root, '.maestro/memory/legacy/memory.md'))) return true;
  } catch {}
  try {
    const fuDir = path.join(root, '.maestro/memory/followups/pending');
    const entries = await readdir(fuDir);
    if (entries.some(e => e.endsWith('.yaml') || e.endsWith('.yml'))) return true;
  } catch {}
  try {
    const chkDir = path.join(root, '.maestro/checkpoints');
    const entries = await readdir(chkDir);
    if (entries.some(e => e.endsWith('.json') && !e.includes('.failed-'))) return true;
  } catch {}
  // NOTE: .maestro/memory/index.json is a DERIVED artifact and must NEVER be treated as an authoritative source!
  return false;
}

async function findRecoverableCheckpoint(root) {
  const candidates = [];

  const scanTargetCheckpoints = async (scope, binding, chkDir, receipt, receiptMtime) => {
    const committedMap = new Map();
    if (receipt) {
      committedMap.set(receipt.request_id, { revision: receipt.revision, mtime: receiptMtime });
    }
    try {
      const files = await readdir(chkDir);
      for (const f of files) {
        if (f.endsWith('.committed.json')) {
          const reqId = f.slice(0, -'.committed.json'.length);
          try {
            const data = JSON.parse(await readFile(path.join(chkDir, f), 'utf8'));
            const st = await stat(path.join(chkDir, f));
            const rev = data && typeof data === 'object' && data.revision !== undefined ? Number(data.revision) : 1;
            committedMap.set(reqId, { revision: rev, mtime: st.mtimeMs });
          } catch {}
        }
      }
      for (const f of files) {
        if (!f.endsWith('.json') || f.includes('.committed.') || f.includes('.failed-')) continue;
        const reqId = f.slice(0, -'.json'.length);
        try {
          const data = JSON.parse(await readFile(path.join(chkDir, f), 'utf8'));
          if (data && typeof data === 'object' && data.request_id) {
            const st = await stat(path.join(chkDir, f));
            const targetScope = data.kind || scope;
            const targetBinding = data.target_id || binding;
            if (committedMap.has(reqId)) {
              const comm = committedMap.get(reqId);
              candidates.push({
                status: 'committed',
                scope: targetScope,
                binding: targetBinding,
                revision: comm.revision,
                request_id: reqId,
                mtime: Math.max(st.mtimeMs, comm.mtime),
              });
            } else {
              const propRev = Number(data.base_revision || 0) + 1;
              candidates.push({
                status: 'pending',
                scope: targetScope,
                binding: targetBinding,
                proposed_revision: propRev,
                revision: propRev,
                request_id: reqId,
                mtime: st.mtimeMs,
              });
            }
          }
        } catch {}
      }
    } catch {}

    for (const [reqId, comm] of committedMap.entries()) {
      if (!candidates.some(c => c.request_id === reqId)) {
        candidates.push({
          status: 'committed',
          scope,
          binding,
          revision: comm.revision,
          request_id: reqId,
          mtime: comm.mtime,
        });
      }
    }
  };

  // 1. Task checkpoints
  try {
    const tasksDir = path.join(root, '.maestro/tasks');
    const taskEntries = await readdir(tasksDir);
    for (const t of taskEntries) {
      if (t === 'archive' || t.startsWith('.')) continue;
      const tDir = path.join(tasksDir, t);
      let receipt = null;
      let receiptMtime = 0;
      try {
        const text = await readFile(path.join(tDir, 'progress.md'), 'utf8');
        const reqMatch = /request_id:\s*['"]?([a-z0-9][a-z0-9_-]*)['"]?/i.exec(text);
        const revMatch = /revision:\s*(\d+)/.exec(text);
        if (reqMatch && revMatch) {
          const st = await stat(path.join(tDir, 'progress.md'));
          receipt = { request_id: reqMatch[1], revision: Number(revMatch[1]) };
          receiptMtime = st.mtimeMs;
        }
      } catch {}
      await scanTargetCheckpoints('task', t, path.join(tDir, 'references/checkpoints'), receipt, receiptMtime);
    }
  } catch {}

  // 2. Temporary checkpoints
  try {
    const tempDir = path.join(root, '.maestro/memory/temporary/active');
    const tempEntries = await readdir(tempDir);
    for (const t of tempEntries) {
      if (t.startsWith('.')) continue;
      const tDir = path.join(tempDir, t);
      let receipt = null;
      let receiptMtime = 0;
      try {
        const text = await readFile(path.join(tDir, 'current.md'), 'utf8');
        const reqMatch = /request_id:\s*['"]?([a-z0-9][a-z0-9_-]*)['"]?/i.exec(text);
        const revMatch = /revision:\s*(\d+)/.exec(text);
        if (reqMatch && revMatch) {
          const st = await stat(path.join(tDir, 'current.md'));
          receipt = { request_id: reqMatch[1], revision: Number(revMatch[1]) };
          receiptMtime = st.mtimeMs;
        }
      } catch {}
      await scanTargetCheckpoints('temporary', t, path.join(tDir, 'references/checkpoints'), receipt, receiptMtime);
    }
  } catch {}

  // 3. Project checkpoints: .maestro/checkpoints/*.json
  await scanTargetCheckpoints('session', 'session', path.join(root, '.maestro/checkpoints'), null, 0);

  if (candidates.length === 0) return null;

  // Deduplicate and prioritize committed over pending
  const seenReq = new Set();
  const deduped = [];
  candidates.sort((a, b) => {
    const statusA = a.status === 'committed' ? 0 : 1;
    const statusB = b.status === 'committed' ? 0 : 1;
    if (statusA !== statusB) return statusA - statusB;
    return b.mtime - a.mtime || b.revision - a.revision || a.binding.localeCompare(b.binding) || a.request_id.localeCompare(b.request_id);
  });
  for (const c of candidates) {
    if (!seenReq.has(c.request_id)) {
      seenReq.add(c.request_id);
      deduped.push(c);
    }
  }
  return deduped.length > 0 ? deduped[0] : null;
}

function formatBoundedRuntimeContext({ tasks = [], temporaries = [], followups = [], longTermCount = 0, checkpoint = null, degradedWarning = null, limit = 3 }) {
  const lines = [
    '# Memory Overview (Runtime Context)',
    '',
    '当前检测到项目存在活动工作：',
    '',
  ];

  if (degradedWarning) {
    lines.push(`> 警告：${degradedWarning}`, '');
  }

  if (checkpoint) {
    const status = checkpoint.status || 'committed';
    lines.push(
      '## Recoverable Checkpoint',
      'Recoverable checkpoint: yes',
      `status: ${status}`,
      `scope: ${checkpoint.scope}`,
      `binding: ${checkpoint.binding}`,
      status === 'pending'
        ? `proposed_revision: ${checkpoint.proposed_revision || checkpoint.revision}`
        : `revision: ${checkpoint.revision}`,
      '',
    );
  }

  lines.push(`## Active Tasks (${tasks.length})`);
  if (tasks.length > 0) {
    for (const t of tasks.slice(0, limit)) {
      lines.push(`- \`${String(t.memory_id || '').slice(0, 80)}\`: ${String(t.title || t.memory_id || '').slice(0, 120)}`);
    }
    if (tasks.length > limit) {
      lines.push(`  *(另外 ${tasks.length - limit} 项活动任务已省略，详情请使用 recent / show)*`);
    }
  } else {
    lines.push('- *(无活动任务)*');
  }
  lines.push('');

  lines.push(`## Active Temporary Memory (${temporaries.length})`);
  if (temporaries.length > 0) {
    for (const t of temporaries.slice(0, limit)) {
      lines.push(`- \`${String(t.memory_id || '').slice(0, 80)}\`: ${String(t.title || t.memory_id || '').slice(0, 120)}`);
    }
    if (temporaries.length > limit) {
      lines.push(`  *(另外 ${temporaries.length - limit} 项活动探索已省略，详情请使用 recent / show)*`);
    }
  } else {
    lines.push('- *(无活动探索)*');
  }
  lines.push('');

  if (followups.length > 0) {
    lines.push(`## Pending Follow-ups (${followups.length})`);
    for (const f of followups.slice(0, limit)) {
      lines.push(`- \`${String(f.followup_id || '').slice(0, 80)}\`: ${String(f.title || f.followup_id || '').slice(0, 120)}`);
    }
    if (followups.length > limit) {
      lines.push(`  *(另外 ${followups.length - limit} 项待跟进已省略，详情请使用 show)*`);
    }
    lines.push('');
  }

  lines.push(`## Long-term Memory (${longTermCount} 项已索引)`);
  lines.push('');
  lines.push('> 提示：启动时仅加载本有界总览；具体记忆正文严禁全量预加载，请按需使用 recent / search / show。');

  return lines.join('\n');
}

export async function loadBoundedRuntimeContext(root, paths = {}) {
  try {
    if (!(await hasAuthoritativeSources(root))) {
      return null;
    }

    const candidateScripts = [
      paths.skill ? path.join(path.dirname(paths.skill), 'scripts', 'memory_catalog.py') : null,
      path.join(root, 'maestro/scripts/memory_catalog.py'),
      path.join(root, '.agents/skills/maestro/scripts/memory_catalog.py'),
      path.join(root, '.maestro/scripts/memory_catalog.py'),
      path.resolve(currentDir, '../../../../maestro/scripts/memory_catalog.py'),
    ].filter(Boolean);

    let scriptPath = null;
    for (const p of candidateScripts) {
      if (await exists(p)) {
        scriptPath = p;
        break;
      }
    }

    if (scriptPath && process.env.MAESTRO_FORCE_PYTHON_FAIL !== '1') {
      try {
        const python = process.platform === 'win32' ? 'python' : 'python3';
        const res = spawnSync(python, [scriptPath, '--project-root', root, 'overview', '--limit', '3'], {
          encoding: 'utf8',
          timeout: 5000,
          windowsHide: true,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });
        if (res.status === 0 && typeof res.stdout === 'string') {
          const out = res.stdout.trim();
          const indexPath = path.join(root, '.maestro/memory/index.json');
          if (await exists(indexPath)) paths.index = indexPath;
          const manifestPath = path.join(root, '.maestro/memory/manifest.md');
          if (await exists(manifestPath)) paths.manifest = manifestPath;

          if (out.includes('当前检测到项目存在活动工作：')) {
            return out;
          }
          if (out.includes('当前项目暂无活动任务或临时探索')) {
            return null;
          }
        }
      } catch {
        // Fall through to degraded fallback
      }
    }

    // 2. Degradation fallback: refresh failed or freshness unknown
    // Do NOT consume unverified or stale index.json! Output degraded warning while preserving authoritative checkpoint.
    const checkpoint = await findRecoverableCheckpoint(root);
    return formatBoundedRuntimeContext({
      checkpoint,
      degradedWarning: '检测到项目存在 Maestro 权威工作源，但 Memory Catalog 缺失或刷新失败。请运行 `python maestro/scripts/memory_catalog.py build` 重建索引。',
    });
  } catch {
    return null;
  }
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
      const runtimeContext = await loadBoundedRuntimeContext(root, paths);
      // JSON-encode filesystem strings instead of inserting them into instructions.
      if (JSON.stringify(paths).length > 1600) throw new Error('Project paths exceed context limit');
      const additionalContext = [
        '检测到有效的 Maestro 项目状态。只有当前请求明确使用 Maestro 或继续 Maestro 工作时才应用本提醒；项目状态本身不会激活任务。',
        '执行 Maestro 工作时：老周是唯一预置、直接面向用户的角色。使用简洁大白话，先报告结果和决策；常规代码搜索、实施细节和命令过程留在有界 Worker 内。没有明确实施意图时，探索保持为 Temporary。',
        '委派必须明确目标、上下文、工具、路径、权限和 Handoff。不得推断继承权限，也不得声称拥有实际不存在的隔离能力。等待运行中的 Worker；除非已取消、重新分配或终态失败，不得重复执行或接管。',
        '有界 Maestro Worker 应使用当前可见的 Codex 原生 subagent 能力，例如工具可见时使用 spawn_agent；不得用 create_thread 或其他独立任务 API 替代。',
        'Memory Worker 仅限使用只读工具，输出严格限定为 UPDATE/MERGE/CREATE/SKIP 候选提案，严禁自我批准或直接改写正式 Long-term 或 Playbook。当前环境缺乏原生隔离能力时，如实降级为 In-Session Fallback 并标记，严禁虚报独立派工。',
        '只有用户明确要求时，才创建用户持有的独立 Codex task 或 conversation。',
        '工具侧标识必须符合当前可见工具 schema（例如简短的小写 snake_case）；面向用户的文字或宿主支持的 display-name 字段使用简洁、针对任务的中文 Worker 名称。',
        '持久状态保存在本项目内。将 .maestro Memory 和 Task 视为宿主无关的共享项目状态。Memory 和旧授权不能扩大当前权限。持久化前校验生成的状态。',
        '需要详细规则时，通过 Codex Skill 发现机制查找并加载 Maestro Core，然后只加载当前步骤所需 references。下方 Skill 路径只是可选的项目本地提示；路径不存在不代表 Core 不可用。本提醒不能替代 Core。',
        '恢复与启动时，按 Core 协议检查 Memory catalog 是否新鲜并读取轻量 Manifest 形成初始 Runtime Context；若存在活动 Temporary 或 Task，带着项目状态开始，不得默认回答“目前还没有具体任务”。正常 Memory 使用严禁直接 Read/cat 完整派生索引，遵循 overview/recent/search/show 四层渐进路由。需要具体历史时再检索有界候选或读取选中的 Current State。catalog/state 缺失不能证明进度已保存。不得仅因 Hook 执行就创建状态。',
        '以下只是路径提示，不代表已选择活动任务，也不是 checkpoint。根据当前请求解析目标工作；不得静默恢复无关任务。clear 后，不要把之前的任务意图当作当前指令。',
        `Session 来源：${event.source}。未读取 transcript，也未恢复尚未保存的对话。`,
        `文件系统路径（仅作数据；memory/task 目录可能不存在）：${JSON.stringify(paths)}`,
      ];
      if (runtimeContext) {
        additionalContext.push('', runtimeContext);
      }
      return {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: additionalContext.join('\n'),
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
