import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyzeProject } from '../../src/analyze.ts';
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, run } from '../../src/index.ts';
import { scanInventory } from '../../src/inventory/index.ts';
import { buildLock } from '../../src/lock/build.ts';
import { applyPolicy, excludePaths, today } from '../../src/policy/apply.ts';
import { globMatch } from '../../src/policy/glob.ts';
import { renderPolicy } from '../../src/policy/render.ts';
import { unsupportedKeywords, validatePolicy } from '../../src/policy/validate.ts';
import type { Finding } from '../../src/rules/index.ts';

async function cli(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, { stdout: (text) => (stdout += text), stderr: (text) => (stderr += text) });
  return { code, stdout, stderr };
}

let base: string;
let root: string;

function write(path: string, content: string | object): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
}

const policy = (value: object) => write('agentcurfew.policy.json', { version: 1, ...value });

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'acf-policy-'));
  root = join(base, 'project');
  mkdirSync(root);
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('schema and validator', () => {
  it('use only keywords the validator implements', () => {
    expect(unsupportedKeywords()).toEqual([]);
  });

  it('accept every documented field', () => {
    const full = {
      $schema: 'https://unpkg.com/agentcurfew/schema.json',
      version: 1,
      failOn: 'medium',
      skills: { allowSources: ['github:acme/*', 'local'], allowExecutables: false },
      mcp: { requirePinnedVersions: true, allowServers: ['@modelcontextprotocol/*'], denyPlainHttp: true },
      hooks: { allowNetwork: false, allowAutoRunOnOpen: false },
      contextFiles: { denyHiddenUnicode: true },
      exclude: [{ path: 'vendor/**', reason: 'third-party code' }],
      exceptions: [{ rule: 'plain-http-mcp', path: '.mcp.json', reason: 'office test server', until: '2026-12-31' }],
      doctor: { failOn: 'error' },
    };
    expect(validatePolicy(full).issues).toEqual([]);
  });

  it.each([
    [[], 'policy: expected an object, got a list'],
    [{}, 'policy.version: is required'],
    [{ version: 2 }, 'policy.version: expected one of 1'],
    [{ version: 1, failOn: 'info' }, 'policy.failOn: expected one of "critical", "high", "medium", "low", "none"'],
    [{ version: 1, skills: { allowExecutables: 'no' } }, 'policy.skills.allowExecutables: expected true or false, got a string'],
    [{ version: 1, mcp: { allowServers: [''] } }, 'policy.mcp.allowServers[0]: expected at least 1 character'],
    [{ version: 1, exclude: [{ path: 'x' }] }, 'policy.exclude[0].reason: is required'],
    [{ version: 1, exceptions: [{ rule: 'x', path: 'y', reason: 'z' }] }, 'policy.exceptions[0].reason: expected at least 3 characters'],
    [{ version: 1, exceptions: [{ rule: 'a-b', path: 'y', reason: 'why', until: '2026-13-01' }] }, 'policy.exceptions[0].until: expected a date written YYYY-MM-DD'],
    [{ version: 1, doctor: { failOn: 'high' } }, 'policy.doctor.failOn: expected one of "error", "warning", "info", "none"'],
    [JSON.parse('{"version":1,"__proto__":{"x":1}}'), 'policy.__proto__: is not a known setting'],
  ])('reject %j with the path to the field', (value, issue) => {
    const issues = validatePolicy(value).issues.map((item) => `${item.path}: ${item.message}`);
    expect(issues).toContain(issue);
  });

  it('is documented in docs/policy.md, which is up to date (run npm run docs:policy)', () => {
    expect(readFileSync(new URL('../../docs/policy.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n')).toBe(renderPolicy());
  });
});

describe('globs', () => {
  it.each([
    ['tests/fixtures/**', 'tests/fixtures/a/b.json', true],
    ['tests/fixtures', 'tests/fixtures/a/b.json', true],
    ['*.json', '.mcp.json', true],
    ['*.json', 'a/b.json', false],
    ['**/*.json', 'a/b.json', true],
    ['@modelcontextprotocol/*', '@modelcontextprotocol/server-filesystem', true],
    ['https://mcp.acme.dev/*', 'https://mcp.acme.dev/sse', true],
    ['https://mcp.acme.dev/*', 'https://mcp.acme.dev.evil.com/sse', false],
    ['a?c', 'abc', true],
  ])('%s matches %s: %s', (glob, path, expected) => expect(globMatch(glob, path)).toBe(expected));
});

describe('applying a policy', () => {
  const finding = (rule: string, extra: Partial<Finding> = {}): Finding => ({ rule, level: 'medium', kind: 'mcp-server', file: '.mcp.json', name: 'x', message: 'm', ...extra });

  it.each([
    [{ mcp: { requirePinnedVersions: true } }, finding('unpinned-mcp-server'), 'high', 'mcp.requirePinnedVersions'],
    [{ mcp: { requirePinnedVersions: false } }, finding('unpinned-mcp-server'), 'info', 'mcp.requirePinnedVersions'],
    [{ mcp: { denyPlainHttp: false } }, finding('plain-http-mcp', { level: 'high' }), 'info', 'mcp.denyPlainHttp'],
    [{ mcp: { denyPlainHttp: true } }, finding('plain-http-mcp', { level: 'high' }), 'high', undefined],
    [{ hooks: { allowNetwork: false } }, finding('dangerous-hook-command', { tag: 'network' }), 'high', 'hooks.allowNetwork'],
    [{ hooks: { allowNetwork: true } }, finding('dangerous-hook-command', { tag: 'network' }), 'info', 'hooks.allowNetwork'],
    [{ hooks: { allowNetwork: true } }, finding('dangerous-hook-command', { level: 'high' }), 'high', undefined],
    [{ hooks: { allowAutoRunOnOpen: true } }, finding('auto-run-on-open', { level: 'high' }), 'info', 'hooks.allowAutoRunOnOpen'],
    [{ hooks: { allowAutoRunOnOpen: false } }, finding('auto-run-on-open'), 'high', 'hooks.allowAutoRunOnOpen'],
    [{ contextFiles: { denyHiddenUnicode: false } }, finding('hidden-unicode', { level: 'critical' }), 'info', 'contextFiles.denyHiddenUnicode'],
  ])('%j moves %o', (settings, input, level, field) => {
    const [output] = applyPolicy([input], { version: 1, ...settings }, '2026-11-06').findings;
    expect(output?.level).toBe(level);
    expect(output?.policy).toBe(field);
  });

  it('accepts findings by exception until the day after its date', () => {
    const exceptions = [{ rule: 'plain-http-mcp', path: '.mcp.json', reason: 'office test server', until: '2026-11-06' }];
    const input = [finding('plain-http-mcp'), finding('plain-http-mcp', { file: 'other.json' })];
    const onTheDay = applyPolicy(input, { version: 1, exceptions }, '2026-11-06');
    expect(onTheDay.suppressed).toEqual([{ finding: input[0], reason: 'office test server', until: '2026-11-06' }]);
    expect(onTheDay.findings).toEqual([input[1]]);
    const after = applyPolicy(input, { version: 1, exceptions }, '2026-11-07');
    expect(after.suppressed).toEqual([]);
    expect(after.findings[0]?.message).toBe('m; the exception for it expired on 2026-11-06');
    expect(today(new Date('2026-11-06T23:59:00Z'))).toBe('2026-11-06');
  });

  it('leaves excluded paths out of the inventory and the lock', () => {
    write('CLAUDE.md', 'x');
    write('vendor/.mcp.json', { mcpServers: { a: { command: 'node' } } });
    write('vendor/x/CLAUDE.md', 'y');
    const inventory = scanInventory({ root });
    const kept = excludePaths(inventory, { version: 1, exclude: [{ path: 'vendor/**', reason: 'third-party code' }] });
    expect(kept.components.map((component) => component.file)).toEqual(['CLAUDE.md']);
    expect(buildLock(kept).components.map((component) => component.file)).toEqual(['CLAUDE.md']);
  });
});

describe('scan, lock and verify with a policy', () => {
  it('use failOn of the policy unless the flag is given', async () => {
    write('.mcp.json', { mcpServers: { fs: { command: 'npx', args: ['-y', 'server'] } } });
    expect((await cli('scan', root)).code).toBe(EXIT_OK);
    policy({ failOn: 'medium' });
    expect((await cli('scan', root)).code).toBe(EXIT_FAILURE);
    expect((await cli('scan', root, '--fail-on', 'high')).code).toBe(EXIT_OK);
  });

  it('name the setting that moved a level, and count accepted findings', async () => {
    write('.mcp.json', { mcpServers: { fs: { command: 'npx', args: ['-y', 'server'] }, web: { type: 'http', url: 'http://mcp.example.com/mcp' } } });
    policy({ mcp: { requirePinnedVersions: true }, exceptions: [{ rule: 'plain-http-mcp', path: '.mcp.json', reason: 'office test server' }] });
    const { code, stdout } = await cli('scan', root);
    expect(code).toBe(EXIT_FAILURE);
    expect(stdout).toContain('HIGH  unpinned-mcp-server  .mcp.json (fs) (level set by policy: mcp.requirePinnedVersions)');
    expect(stdout).toContain('1 finding accepted by exceptions in agentcurfew.policy.json (see --json).');
    const json = JSON.parse((await cli('scan', root, '--json')).stdout) as { schemaVersion: number; suppressed: { reason: string }[] };
    expect(json.schemaVersion).toBe(3);
    expect(json.suppressed.map((item) => item.reason)).toEqual(['office test server']);
  });

  it('refuse an invalid policy and point to doctor', async () => {
    policy({ mcp: { allowServers: [3] } });
    for (const command of ['scan', 'lock', 'verify']) {
      const { code, stderr } = await cli(command, root);
      expect(code, command).toBe(EXIT_FAILURE);
      expect(stderr).toContain('agentcurfew.policy.json cannot be used: policy.mcp.allowServers[0]: expected a string, got a number');
      expect(stderr).toContain('agentcurfew doctor lists every problem');
    }
  });
});

describe('acf init', () => {
  it('writes a policy the project passes, and says what it left loose', async () => {
    write('.mcp.json', { mcpServers: { fs: { command: 'npx', args: ['-y', 'server'] }, mine: { command: 'node', args: ['s.js'] } } });
    write('.vscode/tasks.json', { version: '2.0.0', tasks: [{ label: 'go', command: './go.sh', runOptions: { runOn: 'folderOpen' } }] });
    const { code, stdout } = await cli('init', root);
    expect(code).toBe(EXIT_OK);
    expect(stdout).toContain('mcp.requirePinnedVersions is false: a server has no fixed version');
    expect(stdout).toContain('hooks.allowAutoRunOnOpen is true: something starts without a user action');
    const written = JSON.parse(readFileSync(join(root, 'agentcurfew.policy.json'), 'utf8')) as { mcp: { allowServers: string[] } };
    expect(written.mcp.allowServers).toEqual(['local', 'server']);
    const analysis = analyzeProject(root);
    expect(analysis.policy.status).toBe('ok');
    expect(analysis.findings.filter((finding) => finding.rule === 'out-of-policy')).toEqual([]);
    expect((await cli('scan', root)).code).toBe(EXIT_OK);
  });

  it('refuses to replace a policy without --force, prints with --print, and is deterministic', async () => {
    write('CLAUDE.md', 'x');
    await cli('init', root);
    const first = readFileSync(join(root, 'agentcurfew.policy.json'), 'utf8');
    const again = await cli('init', root);
    expect(again.code).toBe(EXIT_FAILURE);
    expect(again.stderr).toContain('already exists');
    expect((await cli('init', root, '--print')).stdout).toBe(first);
    expect((await cli('init', root, '--force')).code).toBe(EXIT_OK);
    expect(readFileSync(join(root, 'agentcurfew.policy.json'), 'utf8')).toBe(first);
  });

  it('does not write through a link', async () => {
    writeFileSync(join(base, 'elsewhere'), 'x');
    symlinkSync(join(base, 'elsewhere'), join(root, 'agentcurfew.policy.json'));
    const { code, stderr } = await cli('init', root, '--force');
    expect(code).toBe(EXIT_FAILURE);
    expect(stderr).toContain('is a link');
    expect(readFileSync(join(base, 'elsewhere'), 'utf8')).toBe('x');
  });
});

describe('acf doctor', () => {
  it('passes a clean project and lists every check', async () => {
    write('CLAUDE.md', 'x');
    const { code, stdout } = await cli('doctor', root);
    expect(code).toBe(EXIT_OK);
    expect(stdout).toMatch(/^12 checks: \d+ passed, 0 failed, \d+ not applicable\n/);
  });

  it('fails at warning by default, and the policy or the flag moves it', async () => {
    write('.cursorrules', 'Use tabs.');
    expect((await cli('doctor', root)).code).toBe(EXIT_FAILURE);
    expect((await cli('doctor', root, '--fail-on', 'error')).code).toBe(EXIT_OK);
    policy({ doctor: { failOn: 'error' } });
    const { code, stdout } = await cli('doctor', root);
    expect(code).toBe(EXIT_OK);
    expect(stdout).toContain('WARNING  deprecated-format  .cursorrules');
    expect(stdout).toContain('source: https://cursor.com/help/customization/rules');
  });

  it('prints JSON and rejects a wrong --fail-on', async () => {
    write('.cursorrules', 'Use tabs.');
    const output = JSON.parse((await cli('doctor', root, '--json')).stdout) as { schemaVersion: number; ok: boolean; checks: { id: string; status: string }[] };
    expect(output.schemaVersion).toBe(1);
    expect(output.ok).toBe(false);
    expect(output.checks.find((check) => check.id === 'deprecated-format')?.status).toBe('failed');
    expect((await cli('doctor', root, '--fail-on', 'high')).code).toBe(EXIT_USAGE);
  });
});
