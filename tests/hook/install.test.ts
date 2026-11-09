import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { canLinkFiles, linkDirectory, linkFile } from '../support/links.ts';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addHook, hookEntry } from '../../src/hook/install.ts';
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, run } from '../../src/index.ts';

const fixture = fileURLToPath(new URL('../fixtures/init-hook/with-depcurfew', import.meta.url));

async function cli(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, { stdout: (text) => (stdout += text), stderr: (text) => (stderr += text) });
  return { code, stdout, stderr };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'acf-init-hook-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const settings = () => JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8')) as { permissions: unknown; hooks: { PreToolUse: { matcher: string; hooks: unknown[] }[] } };

describe('agentcurfew init --hook', () => {
  it('adds the hook next to depcurfew and keeps depcurfew exactly as it was', async () => {
    cpSync(fixture, root, { recursive: true });
    const before = JSON.parse(readFileSync(join(fixture, '.claude/settings.json'), 'utf8')) as ReturnType<typeof settings>;
    const { code, stdout } = await cli('init', root, '--hook');
    expect(code).toBe(EXIT_OK);
    expect(stdout).toContain('Added the agentcurfew hook to .claude/settings.json.');
    expect(stdout).toContain('depcurfew/dist/cli.js check --hook claude-code');
    const after = settings();
    expect(after.permissions).toEqual(before.permissions);
    expect(after.hooks.PreToolUse[0]).toEqual(before.hooks.PreToolUse[0]);
    expect(after.hooks.PreToolUse[1]).toEqual(hookEntry());
    expect(after.hooks.PreToolUse[1]).toEqual({
      matcher: 'Bash|PowerShell|Write|Edit|NotebookEdit',
      hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/node_modules/agentcurfew/dist/cli.js', 'hook'], timeout: 30 }],
    });
  });

  it('does not add it twice', async () => {
    cpSync(fixture, root, { recursive: true });
    await cli('init', root, '--hook');
    const once = readFileSync(join(root, '.claude/settings.json'), 'utf8');
    const { code, stdout } = await cli('init', root, '--hook');
    expect(code).toBe(EXIT_OK);
    expect(stdout).toContain('already in .claude/settings.json');
    expect(readFileSync(join(root, '.claude/settings.json'), 'utf8')).toBe(once);
  });

  it('creates the settings in an empty project, prints with --print and refuses --force', async () => {
    expect((await cli('init', root, '--hook', '--print')).stdout).toContain('"agentcurfew/dist/cli.js"'.slice(1, -1));
    expect(() => readFileSync(join(root, '.claude/settings.json'))).toThrow();
    expect((await cli('init', root, '--hook')).code).toBe(EXIT_OK);
    expect(settings().hooks.PreToolUse).toHaveLength(1);
    expect((await cli('init', root, '--hook', '--force')).code).toBe(EXIT_USAGE);
  });

  it('refuses settings it would damage, and links', async () => {
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, '.claude/settings.json'), '{\n  // a comment\n  "hooks": {}\n}\n');
    const commented = await cli('init', root, '--hook');
    expect(commented.code).toBe(EXIT_FAILURE);
    expect(commented.stderr).toContain('because it has comments, which would be lost');
    expect(commented.stderr).toContain('fix: add this entry to hooks.PreToolUse by hand');
    if (!canLinkFiles) return;
    rmSync(join(root, '.claude/settings.json'));
    writeFileSync(join(root, 'elsewhere.json'), '{}');
    linkFile(join(root, 'elsewhere.json'), join(root, '.claude/settings.json'));
    expect((await cli('init', root, '--hook')).stderr).toContain('is a link');
    expect(readFileSync(join(root, 'elsewhere.json'), 'utf8')).toBe('{}');
  });

  it('refuses a .claude folder that is a link out of the project', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'acf-outside-'));
    try {
      linkDirectory(outside, join(root, '.claude'));
      const result = await cli('init', root, '--hook');
      expect(result.code).toBe(EXIT_FAILURE);
      expect(result.stderr).toContain('.claude is a link');
      expect(existsSync(join(outside, 'settings.json'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('reports shapes it cannot extend', () => {
    expect(addHook('[]')).toEqual({ status: 'refused', reason: 'it is not a JSON object' });
    expect(addHook('{"hooks":[]}')).toEqual({ status: 'refused', reason: 'its hooks field is not an object' });
    expect(addHook('{"hooks":{"PreToolUse":{}}}')).toEqual({ status: 'refused', reason: 'its hooks.PreToolUse field is not a list' });
    expect(addHook('nope')).toEqual({ status: 'refused', reason: 'it is not valid JSON' });
  });
});
