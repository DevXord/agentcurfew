import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanInventory } from '../../src/inventory/index.ts';

let base: string;
let root: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'acf-'));
  root = join(base, 'project');
  outside = join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function write(path: string, text: string, under = root): void {
  const full = join(under, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

/** False where the system refuses file links (Windows without Developer Mode). */
function linkFile(target: string, path: string): boolean {
  mkdirSync(dirname(path), { recursive: true });
  try {
    symlinkSync(target, path, 'file');
    return true;
  } catch {
    return false;
  }
}

function linkDirectory(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, 'junction');
}

describe('symbolic links', () => {
  it('does not read a directory link that leaves the project', () => {
    write('.claude/skills/stolen/SKILL.md', 'SECRET-OUTSIDE', outside);
    linkDirectory(join(outside, '.claude'), join(root, '.claude'));
    const inventory = scanInventory({ root });
    expect(inventory.components).toEqual([]);
    expect(inventory.problems.map((p) => `${p.code} ${p.file}`)).toEqual(['outside-project .claude']);
  });

  it('does not read a file link that leaves the project', (context) => {
    write('secret.md', 'SECRET-OUTSIDE', outside);
    if (!linkFile(join(outside, 'secret.md'), join(root, 'CLAUDE.md'))) return context.skip();
    const inventory = scanInventory({ root });
    expect(JSON.stringify(inventory)).not.toContain('SECRET-OUTSIDE');
    expect(inventory.problems.map((p) => `${p.code} ${p.file}`)).toEqual(['outside-project CLAUDE.md']);
  });

  it('does not list a link that leaves a skill folder, and says so', () => {
    write('.claude/skills/a/SKILL.md', 'x');
    write('data/file.txt', 'SECRET-OUTSIDE', outside);
    linkDirectory(join(outside, 'data'), join(root, '.claude/skills/a/data'));
    const inventory = scanInventory({ root });
    expect(inventory.components[0]?.files?.map((f) => f.path)).toEqual(['SKILL.md']);
    expect(inventory.problems.map((p) => `${p.code} ${p.file}`)).toEqual(['outside-project .claude/skills/a/data']);
  });

  it('follows a link that stays inside the project', () => {
    write('shared/skills/a/SKILL.md', 'x');
    linkDirectory(join(root, 'shared/skills'), join(root, '.claude/skills'));
    const inventory = scanInventory({ root });
    expect(inventory.components.map((c) => c.file)).toEqual(['.claude/skills/a/SKILL.md']);
    expect(inventory.problems).toEqual([]);
  });

  it('survives a link loop', () => {
    write('a/AGENTS.md', 'x');
    linkDirectory(root, join(root, 'a/loop'));
    const inventory = scanInventory({ root });
    expect(inventory.components.map((c) => c.file)).toEqual(['a/AGENTS.md']);
  });
});

describe('limits', () => {
  it('does not read a file over the size limit, and says so', () => {
    write('CLAUDE.md', 'x'.repeat(2000));
    const inventory = scanInventory({ root, limits: { maxFileBytes: 1000 } });
    expect(inventory.components).toEqual([]);
    expect(inventory.problems.map((p) => `${p.code} ${p.file}`)).toEqual(['too-large CLAUDE.md']);
  });

  it('stops at the depth limit, and says so', () => {
    write(`${'d/'.repeat(12)}AGENTS.md`, 'x');
    const inventory = scanInventory({ root, limits: { maxDepth: 5 } });
    expect(inventory.components).toEqual([]);
    expect(inventory.problems.map((p) => p.code)).toEqual(['too-deep']);
  });

  it('stops at the entry limit, and says so', () => {
    for (let i = 0; i < 50; i++) write(`many/f${i}.txt`, 'x');
    const inventory = scanInventory({ root, limits: { maxEntries: 10 } });
    expect(inventory.problems.map((p) => p.code)).toContain('too-many-entries');
  });

  it('skips node_modules and .git in a search through the project', () => {
    write('node_modules/pkg/AGENTS.md', 'x');
    write('.git/AGENTS.md', 'x');
    write('src/AGENTS.md', 'x');
    expect(scanInventory({ root }).components.map((c) => c.file)).toEqual(['src/AGENTS.md']);
  });

  it('reports nesting too deep to analyse instead of crashing', () => {
    write('.mcp.json', `{"mcpServers":{"a":${'['.repeat(5000)}${']'.repeat(5000)}}}`);
    const inventory = scanInventory({ root });
    expect(inventory.components).toEqual([]);
    expect(inventory.problems.map((p) => `${p.code} ${p.file}`)).toEqual(['unparsable .mcp.json']);
  });

  it('does not mistake a directory for a file', () => {
    mkdirSync(join(root, 'CLAUDE.md'));
    expect(scanInventory({ root })).toEqual({ components: [], problems: [] });
  });
});

describe('user scope', () => {
  let home: string;

  beforeEach(() => {
    home = join(base, 'home');
    write('.claude/CLAUDE.md', 'user rules', home);
    write('.claude/skills/mine/SKILL.md', 'x', home);
    write('.mcp.json', '{"mcpServers":{"a":{"command":"node"}}}');
  });

  it('stays out of the home directory by default', () => {
    expect(scanInventory({ root, home }).components.map((c) => c.scope)).toEqual(['project']);
  });

  it('reads it when asked, and writes paths without the home directory', () => {
    const { components } = scanInventory({ root, home, user: true, platform: 'linux' });
    const user = components.filter((c) => c.scope === 'user');
    expect(user.map((c) => c.file).sort()).toEqual(['~/.claude/CLAUDE.md', '~/.claude/skills/mine/SKILL.md']);
    expect(JSON.stringify(components)).not.toContain(base.replaceAll('\\', '\\\\'));
  });

  it('skips paths of another platform', () => {
    const { problems } = scanInventory({ root, home, user: true, platform: 'win32', env: {} });
    expect(problems).toEqual([]);
  });

  it('expands variables only where they are set', () => {
    write('Code/User/settings.json', '{"chat.tools.global.autoApprove":true}', join(base, 'appdata'));
    const { components } = scanInventory({ root, home, user: true, platform: 'win32', env: { APPDATA: join(base, 'appdata') } });
    expect(components.filter((c) => c.kind === 'permission').map((c) => c.file)).toEqual(['%APPDATA%/Code/User/settings.json']);
  });
});

describe('the scanner runs nothing', () => {
  it('leaves a command in a hook unexecuted', () => {
    const canary = join(base, 'canary');
    write('.claude/settings.json', JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node -e "require('fs').writeFileSync('${canary.replaceAll('\\', '/')}','x')"` }] }] } }));
    write('.claude/skills/a/SKILL.md', 'x');
    write('.claude/skills/a/run.sh', `#!/bin/sh\ntouch ${canary}\n`);
    chmodSync(join(root, '.claude/skills/a/run.sh'), 0o755);
    expect(scanInventory({ root }).components.length).toBeGreaterThan(1);
    expect(existsSync(canary)).toBe(false);
  });

  it('has no way to start a process or reach the network in its source', () => {
    const FORBIDDEN = /node:child_process|['"]child_process['"]|node:net\b|node:http|node:https|node:tls|node:dgram|node:dns|\bfetch\(|new WebSocket|\beval\(|new Function\(/;
    const source = fileURLToPath(new URL('../../src/', import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        return statSync(path).isDirectory() ? walk(path) : [path];
      });
    const files = walk(source).filter((file) => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) expect(`${file}: ${FORBIDDEN.test(readFileSync(file, 'utf8'))}`).toBe(`${file}: false`);
  });
});
