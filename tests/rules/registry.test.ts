import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findRule, LEVELS, OWASP_AST, plannedRules, rules } from '../../src/rules/index.ts';
import { renderRules } from '../../src/rules/render.ts';

describe('rule registry', () => {
  it.each(rules.map((rule) => [rule.id, rule] as const))('%s is complete', (_id, rule) => {
    expect(rule.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    expect(LEVELS).toContain(rule.level);
    expect(rule.owasp.length).toBeGreaterThan(0);
    for (const id of rule.owasp) expect(Object.keys(OWASP_AST)).toContain(id);
    for (const text of [rule.title, rule.description, rule.fix, rule.example]) expect(text.trim().length).toBeGreaterThan(10);
    expect(rule.kinds.length).toBeGreaterThan(0);
    expect(findRule(rule.id)).toBe(rule);
  });

  it('has unique ids, planned ones included', () => {
    const ids = [...rules.map((rule) => rule.id), ...plannedRules.map((rule) => rule.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('documents every rule in docs/rules.md, which is up to date (run npm run docs:rules)', () => {
    const file = readFileSync(new URL('../../docs/rules.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
    expect(file).toBe(renderRules());
    for (const rule of rules) expect(file).toContain(`## ${rule.id}\n`);
  });
});
