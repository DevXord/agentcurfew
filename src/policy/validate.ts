import schema from '../../schema.json' with { type: 'json' };
import type { Policy, PolicyIssue } from './types.ts';

/** The part of JSON Schema that schema.json uses; the validator reads schema.json itself, so the two cannot drift. */
interface Schema {
  type?: 'object' | 'array' | 'string' | 'boolean' | 'integer';
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: unknown[];
  pattern?: string;
  minLength?: number;
  format?: 'date';
}

export const POLICY_SCHEMA = schema as unknown as Schema & { $id: string };

const SUPPORTED = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'pattern', 'minLength', 'format', 'description', 'title', '$schema', '$id']);

/** Keywords of a schema that this validator does not implement; a test keeps this empty for schema.json. */
export function unsupportedKeywords(node: unknown = POLICY_SCHEMA, path = '#'): string[] {
  if (typeof node !== 'object' || node === null) return [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (!SUPPORTED.has(key)) found.push(`${path}/${key}`);
    if (key === 'properties') for (const [name, inner] of Object.entries(value as object)) found.push(...unsupportedKeywords(inner, `${path}/properties/${name}`));
    if (key === 'items') found.push(...unsupportedKeywords(value, `${path}/items`));
  }
  return found;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}

const TYPE_NAMES = { object: 'an object', array: 'a list', string: 'a string', boolean: 'true or false', integer: 'a whole number' } as const;

function validDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}

function check(node: Schema, value: unknown, path: string, issues: PolicyIssue[]): void {
  const type = node.type;
  const matches =
    type === undefined ||
    (type === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) ||
    (type === 'array' && Array.isArray(value)) ||
    (type === 'string' && typeof value === 'string') ||
    (type === 'boolean' && typeof value === 'boolean') ||
    (type === 'integer' && Number.isInteger(value));
  if (!matches) {
    issues.push({ path, message: `expected ${TYPE_NAMES[type as keyof typeof TYPE_NAMES]}, got ${describe(value)}` });
    return;
  }
  if (node.enum !== undefined && !node.enum.includes(value)) {
    issues.push({ path, message: `expected one of ${node.enum.map((item) => JSON.stringify(item)).join(', ')}` });
    return;
  }
  if (typeof value === 'string') {
    if (node.minLength !== undefined && [...value].length < node.minLength) issues.push({ path, message: `expected at least ${node.minLength} ${node.minLength === 1 ? 'character' : 'characters'}` });
    if (node.pattern !== undefined && !new RegExp(node.pattern, 'u').test(value)) issues.push({ path, message: 'does not have the expected form' });
    if (node.format === 'date' && !validDate(value)) issues.push({ path, message: 'expected a date written YYYY-MM-DD' });
    return;
  }
  if (Array.isArray(value)) {
    if (node.items !== undefined) value.forEach((item, index) => check(node.items as Schema, item, `${path}[${index}]`, issues));
    return;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    for (const name of node.required ?? []) if (!Object.hasOwn(record, name)) issues.push({ path: `${path}.${name}`, message: 'is required' });
    for (const [name, item] of Object.entries(record)) {
      const inner = node.properties !== undefined && Object.hasOwn(node.properties, name) ? node.properties[name] : undefined;
      if (inner === undefined) {
        if (node.additionalProperties === false) issues.push({ path: `${path}.${name}`, message: 'is not a known setting' });
        continue;
      }
      check(inner, item, `${path}.${name}`, issues);
    }
  }
}

/** The issues of a parsed policy against schema.json; none means it is a Policy. */
export function validatePolicy(value: unknown): { policy: Policy; issues: [] } | { issues: PolicyIssue[] } {
  const issues: PolicyIssue[] = [];
  check(POLICY_SCHEMA, value, 'policy', issues);
  return issues.length === 0 ? { policy: value as Policy, issues: [] } : { issues };
}
