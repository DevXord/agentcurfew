import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, INVENTORY_SCHEMA_VERSION, run } from '../src/index.ts';

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
    writeFileSync(join(base, '.mcp.json'), JSON.stringify({ mcpServers: { 'evil‮\u{e0041}\u001b[31m': { command: 'node' } } }));
    const text = await cli('scan', base, '--inventory');
    const json = await cli('scan', base, '--inventory', '--json');
    rmSync(base, { recursive: true, force: true });
    for (const output of [text.stdout, json.stdout]) expect(output).not.toMatch(/[‮\u001b]|\u{e0041}/u);
    expect((JSON.parse(json.stdout) as { components: { name: string }[] }).components[0]?.name).toBe('evil‮\u{e0041}\u001b[31m');
  });

  it('needs --inventory while there are no rules', async () => {
    const { code, stderr } = await cli('scan', fixture('empty'));
    expect(code).toBe(EXIT_USAGE);
    expect(stderr).toContain('--inventory');
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
