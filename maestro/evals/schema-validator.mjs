import { isDeepStrictEqual } from 'node:util';

const supportedKeywords = new Set([
  '$schema', '$id', 'title', 'description', 'type', 'const', 'enum', 'required', 'properties',
  'additionalProperties', 'dependentRequired', 'items', 'minItems', 'maxItems', 'uniqueItems',
  'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'allOf', 'anyOf', 'oneOf', 'not',
]);

function assertSupportedSchema(schema, pointer = '') {
  if (typeof schema === 'boolean') return;
  for (const keyword of Object.keys(schema)) {
    if (!supportedKeywords.has(keyword)) {
      throw new Error(`Unsupported JSON Schema keyword at ${pointer || '/'}: ${keyword}`);
    }
  }
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    assertSupportedSchema(child, joinPointer(joinPointer(pointer, 'properties'), name));
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    assertSupportedSchema(schema.additionalProperties, joinPointer(pointer, 'additionalProperties'));
  }
  if (schema.items && typeof schema.items === 'object') {
    assertSupportedSchema(schema.items, joinPointer(pointer, 'items'));
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    (schema[keyword] ?? []).forEach((child, index) => {
      assertSupportedSchema(child, joinPointer(joinPointer(pointer, keyword), index));
    });
  }
  if (schema.not) assertSupportedSchema(schema.not, joinPointer(pointer, 'not'));
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value === 'object' ? 'object' : typeof value;
}

function escapePointer(segment) {
  return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
}

function joinPointer(pointer, segment) {
  return `${pointer}/${escapePointer(segment)}`;
}

function displayPointer(pointer) {
  return pointer || '/';
}

function matchesType(expected, value) {
  const actual = valueType(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
}

function checkType(schema, value, pointer, errors) {
  if (schema.type === undefined) return true;
  const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (expected.some((candidate) => matchesType(candidate, value))) return true;
  errors.push(`${displayPointer(pointer)}: must be ${expected.join(' or ')}`);
  return false;
}

function validateCombinators(schema, value, pointer, errors) {
  if (schema.allOf) {
    for (const child of schema.allOf) validateNode(child, value, pointer, errors);
  }
  if (schema.anyOf) {
    const matches = schema.anyOf.filter((child) => validateJsonSchema(child, value).length === 0);
    if (matches.length === 0) errors.push(`${displayPointer(pointer)}: must match at least one anyOf schema`);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((child) => validateJsonSchema(child, value).length === 0);
    if (matches.length !== 1) errors.push(`${displayPointer(pointer)}: must match exactly one oneOf schema`);
  }
  if (schema.not && validateJsonSchema(schema.not, value).length === 0) {
    errors.push(`${displayPointer(pointer)}: must not match the forbidden schema`);
  }
}

function validateObject(schema, value, pointer, errors) {
  if (valueType(value) !== 'object') return;
  const properties = schema.properties ?? {};
  for (const required of schema.required ?? []) {
    if (!(required in value)) errors.push(`${joinPointer(pointer, required)}: is required`);
  }
  for (const [key, childValue] of Object.entries(value)) {
    const childPointer = joinPointer(pointer, key);
    if (key in properties) {
      validateNode(properties[key], childValue, childPointer, errors);
    } else if (schema.additionalProperties === false) {
      errors.push(`${childPointer}: additional property is not allowed`);
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      validateNode(schema.additionalProperties, childValue, childPointer, errors);
    }
  }
  for (const [key, dependencies] of Object.entries(schema.dependentRequired ?? {})) {
    if (!(key in value)) continue;
    for (const dependency of dependencies) {
      if (!(dependency in value)) {
        errors.push(`${joinPointer(pointer, dependency)}: is required when ${key} is present`);
      }
    }
  }
}

function validateArray(schema, value, pointer, errors) {
  if (!Array.isArray(value)) return;
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    errors.push(`${displayPointer(pointer)}: must contain at least ${schema.minItems} item(s)`);
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    errors.push(`${displayPointer(pointer)}: must contain at most ${schema.maxItems} item(s)`);
  }
  if (schema.uniqueItems) {
    for (let index = 0; index < value.length; index += 1) {
      if (value.slice(0, index).some((candidate) => isDeepStrictEqual(candidate, value[index]))) {
        errors.push(`${joinPointer(pointer, index)}: must be unique`);
      }
    }
  }
  if (schema.items && typeof schema.items === 'object') {
    value.forEach((item, index) => validateNode(schema.items, item, joinPointer(pointer, index), errors));
  }
}

function validateString(schema, value, pointer, errors) {
  if (typeof value !== 'string') return;
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push(`${displayPointer(pointer)}: must contain at least ${schema.minLength} character(s)`);
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push(`${displayPointer(pointer)}: must contain at most ${schema.maxLength} character(s)`);
  }
  if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${displayPointer(pointer)}: must match pattern ${schema.pattern}`);
  }
}

function validateNumber(schema, value, pointer, errors) {
  if (typeof value !== 'number') return;
  if (schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${displayPointer(pointer)}: must be >= ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    errors.push(`${displayPointer(pointer)}: must be <= ${schema.maximum}`);
  }
}

function validateNode(schema, value, pointer, errors) {
  if (typeof schema === 'boolean') {
    if (!schema) errors.push(`${displayPointer(pointer)}: is forbidden by schema`);
    return;
  }
  if (schema.$ref) throw new Error(`Unresolved JSON Schema reference: ${schema.$ref}`);
  if (schema.const !== undefined && !isDeepStrictEqual(value, schema.const)) {
    errors.push(`${displayPointer(pointer)}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((candidate) => isDeepStrictEqual(candidate, value))) {
    errors.push(`${displayPointer(pointer)}: must be one of ${schema.enum.map(JSON.stringify).join(', ')}`);
  }
  const typeMatches = checkType(schema, value, pointer, errors);
  validateCombinators(schema, value, pointer, errors);
  if (!typeMatches) return;
  validateObject(schema, value, pointer, errors);
  validateArray(schema, value, pointer, errors);
  validateString(schema, value, pointer, errors);
  validateNumber(schema, value, pointer, errors);
}

export function validateJsonSchema(schema, value) {
  assertSupportedSchema(schema);
  const errors = [];
  validateNode(schema, value, '', errors);
  return errors;
}
