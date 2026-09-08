import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { CheckpointError, CheckpointWriter, type CheckpointConfig, type CheckpointFs, type CheckpointInput } from './checkpoint'
import { MaestroSchemaValidator } from './validate'

/** Native ToolDefinition: execution stays inside DSH's approval/cancellation pipeline. */
export function checkpointTool(fs: CheckpointFs, validator: MaestroSchemaValidator,
  config: CheckpointConfig): ToolDefinition {
  return {
    name: 'maestro_checkpoint',
    description: 'For an explicitly requested Maestro save/handoff: inspect one existing active Temporary/Task, then save a bounded factual snapshot using its revision/hash. Preserve source refs. Use status/retry with the same request ID after errors. Snapshot coverage is only supplied facts, not a transcript backup. No automatic Task creation or historical authorization.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['operation', 'kind', 'target_id'],
      properties: {
        operation: { type: 'string', enum: ['inspect', 'save', 'status', 'retry'] },
        kind: { type: 'string', enum: ['temporary', 'task'] }, target_id: { type: 'string' },
        request_id: { type: 'string' }, base_revision: { type: 'integer' }, base_hash: { type: 'string' },
        snapshot: { type: 'object', additionalProperties: false,
          required: ['objective', 'confirmed', 'rejected', 'in_progress', 'next', 'open_questions', 'source_refs'],
          properties: Object.fromEntries(['objective', 'confirmed', 'rejected', 'in_progress', 'next', 'open_questions',
            'source_refs'].map((key) => [key, key === 'objective' ? { type: 'string' }
              : { type: 'array', items: { type: 'string' } }])) },
      },
    },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(raw, exec) {
      const cwd = exec.agent?.session.header.cwd
      if (!cwd || !exec.agent) return { status: 'failed', code: 'caller_session_required', recovery: 'none' }
      const writer = new CheckpointWriter(fs, validator, config, String(exec.agent.id), exec.signal)
      try {
        exec.signal.throwIfAborted()
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)
          || Buffer.byteLength(JSON.stringify(raw)) > 32768) throw new CheckpointError('invalid_arguments')
        const args = raw as CheckpointInput & { operation: string }
        const keys = args.operation === 'save'
          ? ['operation', 'kind', 'target_id', 'request_id', 'base_revision', 'base_hash', 'snapshot']
          : args.operation === 'inspect' ? ['operation', 'kind', 'target_id']
            : ['operation', 'kind', 'target_id', 'request_id']
        if (Object.keys(raw).length !== keys.length || keys.some((key) => !(key in raw))) {
          throw new CheckpointError('invalid_arguments')
        }
        await writer.initialize(cwd)
        switch (args.operation) {
          case 'inspect': return await writer.inspect(args.kind, args.target_id)
          case 'save': return await writer.save(args)
          case 'status': return await writer.status(args.kind, args.target_id, args.request_id)
          case 'retry': return await writer.retry(args.kind, args.target_id, args.request_id)
          default: throw new CheckpointError('invalid_operation')
        }
      } catch (error) {
        const request = raw as { request_id?: unknown; operation?: unknown } | null
        const failure = request?.operation === 'save' || request?.operation === 'retry'
          ? await writer.reportFailure(error) : writer.failure(error)
        return { ...failure, ...(typeof request?.request_id === 'string'
          && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(request.request_id) ? { request_id: request.request_id } : {}) }
      }
    },
  }
}
