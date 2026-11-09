import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hookId, numbered, taskId } from '../../src/inventory/identity.ts';
import { scanInventory } from '../../src/inventory/index.ts';

const repo = (name: string) => fileURLToPath(new URL(`../fixtures/repos/${name}`, import.meta.url));

describe('component ids', () => {
  it('names a hook by its event, its matcher and a short hash of the handler', () => {
    const id = hookId('PreToolUse', { matcher: 'Bash', handler: { type: 'command', command: 'echo pre' } });
    expect(id).toMatch(/^PreToolUse:Bash:[0-9a-f]{10}$/);
    expect(hookId('Stop', { handler: { type: 'command', command: 'echo pre' } })).toMatch(/^Stop:\*:[0-9a-f]{10}$/);
  });

  it('does not depend on the order of keys', () => {
    expect(hookId('PreToolUse', { matcher: 'Bash', handler: { type: 'command', command: 'x' } })).toBe(hookId('PreToolUse', { handler: { command: 'x', type: 'command' }, matcher: 'Bash' }));
  });

  it('changes with the command', () => {
    expect(hookId('Stop', { command: 'a' })).not.toBe(hookId('Stop', { command: 'b' }));
  });

  it('cannot confirm a secret: a change of the secret alone keeps the id', () => {
    const one = hookId('Stop', { command: 'AWS_SECRET_ACCESS_KEY=abcdefghijklmnopqrstuvwxyz0123456789ABCD ./upload.sh' });
    const two = hookId('Stop', { command: 'AWS_SECRET_ACCESS_KEY=ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210zyxw ./upload.sh' });
    expect(one).toBe(two);
  });

  it('replaces a long or invisible matcher or event with a hash', () => {
    expect(hookId('PreToolUse', { matcher: 'x'.repeat(100), command: 'a' })).toMatch(/^PreToolUse:m-[0-9a-f]{8}:[0-9a-f]{10}$/);
    expect(hookId('PreToolUse', { matcher: 'Bash\u202E', command: 'a' })).toMatch(/^PreToolUse:m-[0-9a-f]{8}:/);
    expect(hookId('Pre\u200BToolUse', { command: 'a' })).toMatch(/^e-[0-9a-f]{8}:\*:/);
  });

  it('names a task by its label, or by a hash of it', () => {
    expect(taskId({ label: 'setup', command: 'x' }, 'setup')).toBe('setup');
    expect(taskId({ command: 'npm ci' }, 'task#2')).toMatch(/^task:[0-9a-f]{10}$/);
  });

  it('numbers ids that repeat, in order', () => {
    expect(numbered(['a', 'b', 'a', 'a'])).toEqual(['a', 'b', 'a~2', 'a~3']);
  });
});

describe('ids in the inventory', () => {
  it('gives every component an id, the name where the name is already stable', () => {
    const { components } = scanInventory({ root: repo('claude-basic') });
    for (const component of components) expect(component.id, `${component.kind} ${component.name}`).toBeTruthy();
    expect(components.find((c) => c.kind === 'mcp-server')?.id).toBe('docs');
    expect(components.find((c) => c.kind === 'permission' && c.name === 'permissions.allow')?.id).toBe('permissions.allow');
    const hook = components.find((c) => c.kind === 'hook' && c.name === 'PreToolUse#0');
    expect(hook?.id).toMatch(/^PreToolUse:Bash:[0-9a-f]{10}$/);
    // The auto-run copy of a hook has the same id as the hook.
    expect(components.find((c) => c.kind === 'auto-run' && c.name === 'SessionStart#0')?.id).toBe(components.find((c) => c.kind === 'hook' && c.name === 'SessionStart#0')?.id);
  });

  it('keeps the ids of other hooks when one is added before them, and changes only the edited one', () => {
    const root = mkdtempSync(join(tmpdir(), 'acf-id-'));
    try {
      cpSync(repo('claude-basic'), root, { recursive: true });
      const ids = () => scanInventory({ root }).components.filter((c) => c.kind === 'hook').map((c) => c.id).sort();
      const before = ids();
      const settings = join(root, '.claude/settings.json');
      const config = JSON.parse(readFileSync(settings, 'utf8')) as { hooks: { PreToolUse: { hooks: { type: string; command: string }[] }[] } };
      config.hooks.PreToolUse.unshift({ hooks: [{ type: 'command', command: 'echo first' }] });
      writeFileSync(settings, JSON.stringify(config));
      const after = ids();
      expect(before.every((id) => after.includes(id))).toBe(true);
      expect(after.length).toBe(before.length + 1);
      config.hooks.PreToolUse[1]!.hooks[0]!.command = 'echo changed';
      writeFileSync(settings, JSON.stringify(config));
      const edited = ids();
      expect(edited.filter((id) => !after.includes(id))).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
