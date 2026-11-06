import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runHook } from '../../src/hook/index.ts';
import { commands, skillsSource } from '../../src/hook/bash.ts';
import { afterEdit, knowledgePath } from '../../src/hook/files.ts';
import { expand } from '../rules/materialize.ts';

const base = fileURLToPath(new URL('../fixtures/hook/', import.meta.url));

function hook(name: string): { stdout: string; stderr: string; root: string } {
  const dir = mkdtempSync(join(tmpdir(), 'acf-hook-'));
  const root = join(dir, 'project');
  const home = join(dir, 'home');
  mkdirSync(home);
  try {
    cpSync(join(base, name, 'project'), root, { recursive: true });
    for (const file of readdirSync(root, { recursive: true }) as string[]) {
      const path = join(root, file);
      try {
        const text = readFileSync(path, 'utf8');
        const expanded = expand(text);
        if (expanded !== text) writeFileSync(path, expanded);
      } catch {
        // A folder.
      }
    }
    const input = expand(readFileSync(join(base, name, 'input.json'), 'utf8')).replaceAll('{{root}}', root.replaceAll('\\', '\\\\')).replaceAll('{{home}}', home.replaceAll('\\', '\\\\'));
    const result = runHook(input, { CLAUDE_PROJECT_DIR: root, HOME: home }, root);
    return { ...result, root };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cases = readdirSync(base).sort();

describe('hook fixtures', () => {
  it.each(cases)('%s', (name) => {
    const expected = JSON.parse(readFileSync(join(base, name, 'expected.json'), 'utf8')) as { decision: string | null; reasonContains: string | null };
    const { stdout, stderr } = hook(name);
    expect(stderr).toBe('');
    if (expected.decision === null) {
      expect(stdout).toBe('');
      return;
    }
    const output = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string } };
    expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(output.hookSpecificOutput.permissionDecision, output.hookSpecificOutput.permissionDecisionReason).toBe(expected.decision);
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain(expected.reasonContains);
    expect(stdout.trim().split('\n')).toHaveLength(1);
  });
});

describe('hook input', () => {
  it('gives no opinion on input it cannot read', () => {
    expect(runHook('not json', {}, tmpdir())).toEqual({ stdout: '', stderr: 'agentcurfew hook: the input is not JSON, so it was not checked\n' });
    expect(runHook('{}', {}, tmpdir())).toEqual({ stdout: '', stderr: '' });
    expect(runHook('[1,2]', {}, tmpdir()).stdout).toBe('');
    expect(runHook('x'.repeat(5 * 1024 * 1024), {}, tmpdir()).stderr).toContain('over the size limit');
  });

  it('never allows', () => {
    for (const name of cases) expect(hook(name).stdout).not.toContain('"allow"');
  });
});

describe('hook helpers', () => {
  it('split shell lines into commands and words', () => {
    expect(commands(`cd x && npx skills add 'a b' -y; echo "q\\"t" | tee f`)).toEqual([['cd', 'x'], ['npx', 'skills', 'add', 'a b', '-y'], ['echo', 'q"t'], ['tee', 'f']]);
  });

  it('find the source of skills add behind launchers and options', () => {
    expect(skillsSource(['npx', 'skills', 'add', 'owner/repo'])).toBe('owner/repo');
    expect(skillsSource(['pnpm', 'dlx', 'skills@1.7.6', 'add', '-a', 'claude-code', 'cursor', '--skill', 'lint', 'owner/repo@v1'])).toBe('owner/repo@v1');
    expect(skillsSource(['npx', 'skills', 'list'])).toBeUndefined();
    expect(skillsSource(['npx', 'other', 'add', 'x'])).toBeUndefined();
  });

  it('apply an edit as the agent would', () => {
    expect(afterEdit('a b a', 'a', 'c', false)).toEqual({ text: 'c b a' });
    expect(afterEdit('a b a', 'a', 'c', true)).toEqual({ text: 'c b c' });
    expect(afterEdit('a $& b', '$&', '$1', false)).toEqual({ text: 'a $1 b' });
    expect(afterEdit(undefined, 'a', 'b', false)).toEqual({ why: 'the file could not be read' });
  });

  it('write paths as the knowledge base does', () => {
    expect(knowledgePath('/p/.claude/settings.json', '/p', '/home/u')).toBe('.claude/settings.json');
    expect(knowledgePath('/home/u/.claude/CLAUDE.md', '/p', '/home/u')).toBe('~/.claude/CLAUDE.md');
    expect(knowledgePath('/etc/x', '/p', '/home/u')).toBeUndefined();
  });
});
