/**
 * Schema validation (capability plugin): validate Maestro's mutable-state
 * documents against the JSON Schemas shipped inside the Core Skill.
 *
 * Maestro Core already owns the schemas (`maestro/references/schemas/*.json`,
 * JSON Schema draft 2020-12). The adapter reuses those files verbatim and adds
 * only the runtime validation call — it does not re-declare or reinterpret the
 * contracts. This keeps the Core as the single source of truth.
 *
 * @module @maestro-ai/dsh-adapter/validate
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import Ajv2020 from 'ajv/dist/2020'

/** Outcome of a single validation run. */
export interface ValidationResult {
  ok: boolean
  errors: string[]
}

/**
 * Validator that loads and evaluates the Core Skill's JSON Schemas.
 */
export class MaestroSchemaValidator {
  private readonly ajv = new Ajv2020({ allErrors: true, strict: false })

  /**
   * Load every `*.json` schema from the Core's `schemas/` directory and
   * register it under its `$id` so {@link validate} can address it.
   *
   * @param schemasDir - absolute path to `maestro/references/schemas/`.
   */
  async loadAll(schemasDir: string): Promise<void> {
    const entries = await readdir(schemasDir)
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const raw = await readFile(path.join(schemasDir, entry), 'utf8')
      const schema = JSON.parse(raw) as { $id?: string }
      this.ajv.addSchema(schema)
      if (typeof schema.$id === 'string') {
        this.ajv.getSchema(schema.$id)
      }
    }
  }

  /**
   * Validate a document against the schema identified by `$id`.
   *
   * @param schemaId - the schema `$id` (e.g. `https://maestro.local/schemas/task.schema.json`).
   * @param data - the parsed document.
   */
  validate(schemaId: string, data: unknown): ValidationResult {
    const validator = this.ajv.getSchema(schemaId)
    if (validator === undefined) {
      return { ok: false, errors: [`schema not loaded: ${schemaId}`] }
    }
    const ok = validator(data)
    if (ok) return { ok: true, errors: [] }
    const errors = (validator.errors ?? []).map(
      (error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`,
    )
    return { ok: false, errors }
  }
}
