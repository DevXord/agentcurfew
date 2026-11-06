import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/index.ts';
import { materialize } from '../rules/materialize.ts';
import { makeAjv } from './ajv.ts';

async function json(...argv: string[]): Promise<unknown> {
  let stdout = '';
  await run(argv, { stdout: (text) => (stdout += text), stderr: () => undefined });
  return JSON.parse(stdout) as unknown;
}

const schema = (name: string) => JSON.parse(readFileSync(new URL(`../../schemas/${name}.json`, import.meta.url), 'utf8')) as object;

function check(name: string, value: unknown): void {
  const validate = makeAjv().compile(schema(name));
  validate(value);
  expect(validate.errors ?? [], `${name}: ${JSON.stringify(validate.errors)}`).toEqual([]);
}

const FIXTURES = ['hidden-unicode', 'secret-in-config', 'drift', 'skills-lock-mismatch', 'out-of-policy', 'obfuscated-content'];

describe('JSON output follows schemas/', () => {
  it.each(FIXTURES)('scan and scan --inventory on the %s fixture', async (rule) => {
    const { root, cleanup } = materialize(`${rule}/positive`);
    try {
      check('scan', await json('scan', root, '--json'));
      check('inventory', await json('scan', root, '--inventory', '--json'));
      check('doctor', await json('doctor', root, '--json'));
    } finally {
      cleanup();
    }
  });

  it('verify, with drift and with skills-lock.json findings', async () => {
    for (const rule of ['drift', 'skills-lock-mismatch']) {
      const { root, cleanup } = materialize(`${rule}/positive`);
      try {
        if (rule === 'skills-lock-mismatch') await json('lock', root).catch(() => undefined);
        check('verify', await json('verify', root, '--json'));
      } finally {
        cleanup();
      }
    }
  });

  it('scan with accepted findings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'acf-schema-'));
    try {
      writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { web: { type: 'http', url: 'http://mcp.example.com/mcp' } } }));
      writeFileSync(join(root, 'agentcurfew.policy.json'), JSON.stringify({ version: 1, mcp: { requirePinnedVersions: true }, exceptions: [{ rule: 'plain-http-mcp', path: '.mcp.json', reason: 'test server', until: '2999-01-01' }] }));
      const output = (await json('scan', root, '--json')) as { suppressed: unknown[] };
      expect(output.suppressed).toHaveLength(1);
      check('scan', output);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
