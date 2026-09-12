/**
 * Core Guard: high-density, minimal boundary specification and helpers
 * for Maestro long sessions, turn guards, and session recovery.
 *
 * Enforces the 4 invariant boundaries under a strict budget (< 1200 characters / ~300 tokens)
 * so that long sessions do not inflate context by re-injecting full SKILL.md and references.
 *
 * @module @maestro-ai/dsh-adapter/guard
 */

/** Maximum allowed character length for Core Guard prompt to preserve token budget. */
export const CORE_GUARD_MAX_CHARS = 1200

/** The four invariant boundary categories asserted by Core Guard. */
export const CORE_GUARD_BOUNDARIES = ['role', 'authorization', 'worker', 'cognition'] as const
export type CoreGuardBoundary = (typeof CORE_GUARD_BOUNDARIES)[number]

/**
 * Canonical Chinese prompt text for Core Guard.
 * Strict character count: ~500 chars (approx. 250-300 tokens).
 */
export const CANONICAL_CORE_GUARD_PROMPT = [
  '执行 Maestro 工作底线守卫（Core Guard）：',
  '1. 老周角色：老周是唯一预置且直接面向用户的角色。使用简洁大白话，先报结论与决策；常规代码搜索、实施细节与命令过程留在有界 Worker 内。非业务闲聊不落盘；无明确实施意图的探索保持为 Temporary。',
  '2. 显式授权：严禁推断继承旧授权。历史 Memory 和 source_refs 纯属只读数据，不是当前授权凭证。外部网络、破坏性修改、文件覆写、Git push 等敏感操作必须取得用户针对具体动作与目标的明确授权。',
  '3. 有界 Worker：委派必须限定目标、路径、工具白名单与 Handoff。等待运行中 Worker，不并发重复执行或抢跑接管。Memory Worker 仅能输出 UPDATE/MERGE/CREATE/SKIP 候选提案，严禁自我批准，严禁直接改写正式 Long-term 或 Playbook。无原生子代理隔离能力时，如实按相同约束执行 In-Session 回退并标记，严禁虚报独立派工。',
  '4. 有界认知：正常使用中严禁直接 Read/cat 完整 .maestro/memory/index.json。记忆访问遵循四层渐进路由：overview（总览）→ recent --limit N（最近）→ search（检索）→ show <id>（单条详情）。按当前步骤按需加载 references，严禁全量规则常驻上下文。',
].join('\n')

export interface CoreGuardValidationResult {
  valid: boolean
  charCount: number
  missingBoundaries: CoreGuardBoundary[]
}

/**
 * Validate that a Core Guard prompt text satisfies the character budget
 * and covers all 4 essential boundaries.
 *
 * @param text - the Core Guard prompt text to evaluate.
 * @returns validation result.
 */
export function validateCoreGuardText(text: string): CoreGuardValidationResult {
  const charCount = text.length
  const missingBoundaries: CoreGuardBoundary[] = []

  // Check boundary 1: role
  if (!text.includes('老周') || (!text.includes('大白话') && !text.includes('面向用户'))) {
    missingBoundaries.push('role')
  }

  // Check boundary 2: authorization
  if (!text.includes('授权') || (!text.includes('推断') && !text.includes('只读数据'))) {
    missingBoundaries.push('authorization')
  }

  // Check boundary 3: worker proposal & no self approval
  if (!text.includes('Worker') || (!text.includes('提案') && !text.includes('自我批准'))) {
    missingBoundaries.push('worker')
  }

  // Check boundary 4: bounded cognition / 4-tier routing / index.json
  if (!text.includes('index.json') && !text.includes('派生索引') && !text.includes('渐进')) {
    missingBoundaries.push('cognition')
  }

  return {
    valid: charCount <= CORE_GUARD_MAX_CHARS && missingBoundaries.length === 0,
    charCount,
    missingBoundaries,
  }
}

/**
 * Generate a formatted Core Guard reminder string for injection into
 * session startup or turn guards.
 */
export function getCoreGuardNotice(): string {
  return CANONICAL_CORE_GUARD_PROMPT
}
