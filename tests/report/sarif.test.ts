import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeProjectAsync } from '../../src/analyze.ts';
import { EXIT_FAILURE, EXIT_USAGE, run } from '../../src/index.ts';
import { toSarif } from '../../src/report/sarif.ts';
import { rules } from '../../src/rules/index.ts';
import { fixtureDir, materialize } from '../rules/materialize.ts';
import { makeAjv, sarifSchema } from './ajv.ts';

async function cli(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, { stdout: (text) => (stdout += text), stderr: (text) => (stderr += text) });
  return { code, stdout, stderr };
}

const validate = makeAjv().compile(sarifSchema());

describe('SARIF', () => {
  it('uses the schema file recorded in SOURCE.md', () => {
    const bytes = readFileSync(new URL('../fixtures/sarif/sarif-schema-2.1.0.json', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('c3b4bb2d6093897483348925aaa73af03b3e3f4bd4ca38cef26dcb4212a2682e');
  });

  it('encodes file names as URI references', () => {
    const odd = { rule: 'hidden-unicode', level: 'high' as const, kind: 'context-file' as const, file: 'sub dir ü/a#%%.md', name: 'a#%%.md', message: 'm' };
    const sarif = toSarif([odd], []);
    expect(validate(sarif), JSON.stringify(validate.errors)).toBe(true);
    expect(JSON.stringify(sarif)).toContain('"uri":"sub%20dir%20%C3%BC/a%23%25%25.md"');
  });

  it('is valid SARIF 2.1.0 with files that could not be read', () => {
    const sarif = toSarif([], [], [{ code: 'too-large', file: 'CLAUDE.md' }, { code: 'unreadable', file: '.claude/skills' }]);
    expect(validate(sarif), JSON.stringify(validate.errors)).toBe(true);
    expect((sarif as { runs: { invocations: unknown[] }[] }).runs[0]?.invocations).toHaveLength(1);
  });

  it.each(readdirSync(fixtureDir('')))('is valid SARIF 2.1.0 for the %s fixture', async (rule) => {
    const { root, cleanup } = materialize(`${rule}/positive`);
    try {
      const { findings, suppressed } = await analyzeProjectAsync(root);
      const sarif = toSarif(findings, suppressed);
      const valid = validate(sarif);
      expect(validate.errors ?? [], JSON.stringify(validate.errors)).toEqual([]);
      expect(valid).toBe(true);
      const results = (sarif as { runs: { results: { ruleId: string }[] }[] }).runs[0]?.results ?? [];
      expect(results.some((result) => result.ruleId === rule)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('describes every rule, with OWASP tags and a severity GitHub reads', () => {
    const sarif = toSarif([], []) as { runs: { tool: { driver: { rules: { id: string; helpUri: string; properties: { tags: string[]; 'security-severity': string } }[] } } }[] };
    const described = sarif.runs[0]?.tool.driver.rules ?? [];
    expect(described.map((rule) => rule.id)).toEqual(rules.map((rule) => rule.id));
    for (const rule of described) {
      expect(rule.helpUri).toBe(`https://github.com/DevXord/agentcurfew/blob/main/docs/rules.md#${rule.id}`);
      expect(rule.properties.tags[0]).toBe('security');
      expect(rule.properties.tags.slice(1).every((tag) => /^external\/owasp-ast\/ast\d\d$/.test(tag))).toBe(true);
      expect(Number(rule.properties['security-severity'])).toBeGreaterThan(0);
    }
  });

  it('is deterministic, keeps secrets out and marks accepted findings as suppressed', async () => {
    const { root, cleanup } = materialize('secret-in-config/positive');
    try {
      const first = await cli('scan', root, '--sarif');
      const second = await cli('scan', root, '--sarif');
      expect(first.code).toBe(EXIT_FAILURE);
      expect(first.stdout).toBe(second.stdout);
      expect(first.stdout).not.toMatch(/Ab1Ab1|Q7Q7Q7|efgh12345678|plain-value|\/tmp\/|"startTimeUtc"/);
    } finally {
      cleanup();
    }
    const { root: http, cleanup: done } = materialize('plain-http-mcp/positive');
    try {
      const policy = { version: 1, exceptions: [{ rule: 'plain-http-mcp', path: '.cursor/mcp.json', reason: 'an internal test server' }] };
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${http}/agentcurfew.policy.json`, JSON.stringify(policy));
      const sarif = JSON.parse((await cli('scan', http, '--sarif')).stdout) as { runs: { results: { suppressions?: { kind: string; justification: string }[] }[] }[] };
      expect(validate(sarif)).toBe(true);
      expect(sarif.runs[0]?.results.flatMap((result) => result.suppressions ?? [])).toEqual([{ kind: 'external', justification: 'an internal test server' }]);
    } finally {
      done();
    }
  });

  it('cannot be combined with --json or --inventory', async () => {
    expect((await cli('scan', fixtureDir(''), '--sarif', '--json')).code).toBe(EXIT_USAGE);
    expect((await cli('scan', fixtureDir(''), '--sarif', '--inventory')).code).toBe(EXIT_USAGE);
  });
});
