import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, INVENTORY_SCHEMA_VERSION, run, SCAN_SCHEMA_VERSION } from '../src/index.ts';
import { materialize } from './rules/materialize.ts';

const fixture = (name: string) => fileURLToPath(new URL(`fixtures/repos/${name}`, import.meta.url));
const SECRET = 'not-a-real-secret-0123456789';

async function cli(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { code, stdout, stderr };
}

describe('acf scan --inventory', () => {
  it('prints a versioned JSON list', async () => {
    const { code, stdout, stderr } = await cli('scan', fixture('portable-mcp'), '--inventory', '--json');
    expect(code).toBe(EXIT_OK);
    expect(stderr).toBe('');
    const output = JSON.parse(stdout) as { schemaVersion: number; components: Record<string, unknown>[]; problems: unknown[] };
    expect(output.schemaVersion).toBe(INVENTORY_SCHEMA_VERSION);
    expect(output.problems).toEqual([]);
    expect(output.components[0]).toMatchObject({ kind: 'mcp-server', scope: 'project', file: '.mcp.json', name: 'first', agents: ['claude-code', 'copilot-vscode'] });
    expect(output.components[0]).toHaveProperty('bytes');
  });

  it.each([['--json'], []])('does not print secrets from config files (%j)', async (...flags) => {
    const { stdout, stderr } = await cli('scan', fixture('secrets'), '--inventory', ...flags.filter((flag) => flag !== undefined));
    expect(stdout).toContain('mcp-server');
    expect(stdout + stderr).not.toContain(SECRET);
    expect(stdout).not.toContain('"raw"');
  });

  it('prints a list for people, with the problems', async () => {
    const { code, stdout } = await cli('scan', fixture('invalid-config'), '--inventory');
    expect(code).toBe(EXIT_OK);
    expect(stdout).toContain('2 components found');
    expect(stdout).toContain('mcp-server: .cursor/mcp.json (good) [cursor]');
    expect(stdout).toContain('2 problems:');
    expect(stdout).toContain('unparsable: .mcp.json: could not be parsed');
  });

  it('prints nothing from a file that fails to parse', async () => {
    const base = mkdtempSync(join(tmpdir(), 'acf-'));
    writeFileSync(join(base, '.mcp.json'), `{ "mcpServers": ${SECRET}`);
    const { stdout, stderr } = await cli('scan', base, '--inventory', '--json');
    rmSync(base, { recursive: true, force: true });
    expect(stdout + stderr).not.toContain(SECRET);
    expect(stdout).toContain('unparsable');
  });

  it('shows hidden characters in names only as escapes', async () => {
    const base = mkdtempSync(join(tmpdir(), 'acf-'));
    mkdirSync(join(base, '.cursor'));
    writeFileSync(join(base, '.mcp.json'), JSON.stringify({ mcpServers: { 'evil\u202E\u{e0041}\u001b[31m': { command: 'node' } } }));
    const text = await cli('scan', base, '--inventory');
    const json = await cli('scan', base, '--inventory', '--json');
    rmSync(base, { recursive: true, force: true });
    for (const output of [text.stdout, json.stdout]) expect(output).not.toMatch(/[\u202E\u001b]|\u{e0041}/u);
    expect((JSON.parse(json.stdout) as { components: { name: string }[] }).components[0]?.name).toBe('evil\u202E\u{e0041}\u001b[31m');
  });

  it('says so when the directory does not exist', async () => {
    const { code, stderr } = await cli('scan', fixture('no-such-fixture'), '--inventory');
    expect(code).toBe(EXIT_FAILURE);
    expect(stderr).toContain('not a directory');
    expect(stderr).toContain('fix:');
  });

  it('rejects an unknown option and a second directory', async () => {
    expect((await cli('scan', '--frobnicate', '--inventory')).code).toBe(EXIT_USAGE);
    expect((await cli('scan', 'a', 'b', '--inventory')).code).toBe(EXIT_USAGE);
  });

  it('shows help for scan', async () => {
    const { code, stdout } = await cli('scan', '--help');
    expect(code).toBe(EXIT_OK);
    expect(stdout).toContain('--inventory');
  });
});

describe('acf scan', () => {
  it('passes a project with nothing to report', async () => {
    const { code, stdout } = await cli('scan', fixture('empty'));
    expect(code).toBe(EXIT_OK);
    expect(stdout).toBe('0 components scanned, 0 findings\n');
  });

  it('fails at high by default, and --fail-on moves the threshold', async () => {
    const { root, cleanup } = materialize('hidden-unicode/positive');
    try {
      const plain = await cli('scan', root);
      expect(plain.code).toBe(EXIT_FAILURE);
      expect(plain.stdout).toContain('CRITICAL  hidden-unicode  CLAUDE.md:3:15');
      expect(plain.stdout).toContain('U+E0049');
      expect(plain.stdout).toContain('more: agentcurfew explain hidden-unicode');
      expect(plain.stdout).toContain('Failed: 4 findings at level high or above (change with --fail-on).');
      expect(plain.stdout).not.toMatch(/\u{e0049}|\u202e|\u200b/u);
      expect((await cli('scan', root, '--fail-on', 'none')).code).toBe(EXIT_OK);
      expect((await cli('scan', root, '--fail-on', 'critical')).code).toBe(EXIT_FAILURE);
    } finally {
      cleanup();
    }
    const { root: low, cleanup: done } = materialize('persistence-instruction/positive');
    try {
      expect((await cli('scan', low)).code).toBe(EXIT_OK);
      expect((await cli('scan', low, '--fail-on', 'low')).code).toBe(EXIT_FAILURE);
    } finally {
      done();
    }
  });

  it('prints findings as versioned JSON without file contents or secrets', async () => {
    const { root, cleanup } = materialize('secret-in-config/positive');
    try {
      const { code, stdout } = await cli('scan', root, '--json');
      expect(code).toBe(EXIT_FAILURE);
      const output = JSON.parse(stdout) as { schemaVersion: number; failOn: string; findings: { rule: string }[]; components: object[] };
      expect(output.schemaVersion).toBe(SCAN_SCHEMA_VERSION);
      expect(output.failOn).toBe('high');
      expect(output.findings.some((finding) => finding.rule === 'secret-in-config')).toBe(true);
      expect(stdout).not.toMatch(/Ab1Ab1|Q7Q7Q7|efgh12345678|plain-value/);
      expect(stdout).not.toContain('"raw"');
    } finally {
      cleanup();
    }
  });

  it('masks the secrets of the inventory fixture too', async () => {
    const { stdout, stderr } = await cli('scan', fixture('secrets'));
    expect(stdout).toContain('secret-in-config');
    expect(stdout + stderr).not.toContain(SECRET);
  });

  it('rejects a wrong --fail-on and --fail-on with --inventory', async () => {
    expect((await cli('scan', fixture('empty'), '--fail-on', 'severe')).code).toBe(EXIT_USAGE);
    expect((await cli('scan', fixture('empty'), '--fail-on', 'low', '--inventory')).code).toBe(EXIT_USAGE);
  });
});

describe('acf explain', () => {
  it('explains a rule', async () => {
    const { code, stdout } = await cli('explain', 'unpinned-mcp-server');
    expect(code).toBe(EXIT_OK);
    expect(stdout).toContain('unpinned-mcp-server: MCP server without a fixed version');
    expect(stdout).toContain('OWASP Agentic Skills Top 10: AST02 Supply Chain Compromise, AST07 Update Drift');
    expect(stdout).toContain('Fix: ');
  });

  it('lists the rules when the id is unknown', async () => {
    const { code, stderr } = await cli('explain', 'no-such-rule');
    expect(code).toBe(EXIT_FAILURE);
    expect(stderr).toContain('fix: use one of hidden-unicode,');
    expect((await cli('explain')).code).toBe(EXIT_USAGE);
  });
});

describe('help examples', () => {
  it('all run', async () => {
    const { stdout } = await cli('--help');
    const examples = stdout.split('\n').filter((text) => text.startsWith('  agentcurfew ')).map((text) => text.trim().split(/\s+/).slice(1));
    expect(examples.length).toBeGreaterThan(2);
    // Each runs on a fresh empty project, never on the repository itself, since lock writes a file.
    const base = mkdtempSync(join(tmpdir(), 'acf-help-'));
    try {
      for (const argv of examples) {
        const args = ['scan', 'lock', 'verify', 'init', 'doctor'].includes(argv[0] ?? '') ? [...argv, base] : argv;
        const { code } = await cli(...args);
        expect([EXIT_OK, EXIT_FAILURE], argv.join(' ')).toContain(code);
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
