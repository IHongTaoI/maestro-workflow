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

async function loadBoundedRuntimeContext(indexPath) {
  try {
    const handle = await open(indexPath, 'r');
    try {
      const buffer = Buffer.alloc(256 * 1024 + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead === buffer.length) return null;
      const index = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
      if (!index || typeof index !== 'object' || !Array.isArray(index.entries)) return null;

      const visible = index.entries.filter(e => e && typeof e === 'object' && e.status === 'active');
      const tasks = visible.filter(e => e.record_type === 'task');
      const temporaries = visible.filter(e => e.record_type === 'temporary');
      const followups = Array.isArray(index.pending_followups)
        ? index.pending_followups.filter(f => f && typeof f === 'object' && f.status !== 'completed' && f.status !== 'cancelled')
        : [];

      if (tasks.length === 0 && temporaries.length === 0 && followups.length === 0) {
        return null;
      }

      const limit = 3;
      const lines = [
        '# Memory Overview (Runtime Context)',
        '',
        '当前检测到项目存在活动工作：',
        '',
        `## Active Tasks (${tasks.length})`,
      ];
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

      const longTermCount = visible.filter(e => e.record_type === 'long-term-entry').length;
      lines.push(`## Long-term Memory (${longTermCount} 项已索引)`);
      lines.push('');
      lines.push('> 提示：启动时仅加载本有界总览；具体记忆正文严禁全量预加载，请按需使用 recent / search / show。');

      return lines.join('\n');
    } finally {
      await handle.close();
    }
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
      // JSON-encode filesystem strings instead of inserting them into instructions.
      if (JSON.stringify(paths).length > 1600) throw new Error('Project paths exceed context limit');

      const runtimeContext = paths.index ? await loadBoundedRuntimeContext(paths.index) : null;
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
