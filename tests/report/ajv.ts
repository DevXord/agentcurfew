import { readFileSync } from 'node:fs';
import AjvModule from 'ajv';

// ajv ships CommonJS; its default export is the class itself or sits under default.
const Ajv = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as unknown as typeof AjvModule.default;

/** A validator for test use only. Formats are checked with small, strict functions instead of another package. */
export function makeAjv() {
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addFormat('uri', (text: string) => {
    try {
      return new URL(text).protocol.length > 1;
    } catch {
      return false;
    }
  });
  ajv.addFormat('uri-reference', (text: string) => !/[\s\\]/.test(text));
  ajv.addFormat('date-time', (text: string) => !Number.isNaN(Date.parse(text)) && /^\d{4}-\d{2}-\d{2}T/.test(text));
  return ajv;
}

/** The official SARIF 2.1.0 schema, stored with its source. It is draft-04; its only draft-04 keyword is the top-level id. */
export function sarifSchema(): object {
  const schema = JSON.parse(readFileSync(new URL('../fixtures/sarif/sarif-schema-2.1.0.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  const { id, $schema: _draft, ...rest } = schema;
  return { $id: id, ...rest };
}
