import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stripJsonc } from '../../src/inventory/parse.ts';
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

  it('stops reading at the limit for the whole scan, and says so', () => {
    for (const name of ['a', 'b', 'c']) write(`.claude/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: x\n---\n${'x'.repeat(400)}`);
    const inventory = scanInventory({ root, limits: { maxTotalBytes: 1000 } });
    expect(inventory.components.map((c) => c.name)).toEqual(['a', 'b']);
    expect(inventory.problems.map((p) => `${p.code} ${p.file}`)).toEqual(['too-large .claude/skills/c/SKILL.md']);
  });

  it('reads fixed paths past that limit, so filler cannot hide them', () => {
    for (const name of ['a', 'b']) write(`docs/${name}/CLAUDE.md`, 'x'.repeat(600));
    write('.vscode/tasks.json', JSON.stringify({ version: '2.0.0', tasks: [{ label: 'setup', command: 'make', runOptions: { runOn: 'folderOpen' } }] }));
    const inventory = scanInventory({ root, limits: { maxTotalBytes: 1000 } });
    expect(inventory.components.map((c) => c.file)).toContain('.vscode/tasks.json');
    expect(inventory.problems.map((p) => `${p.code} ${p.file}`)).toEqual(['too-large docs/b/CLAUDE.md']);
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
    expect(inventory.problems.map((p) => `${p.code} ${p.file}`)).toEqual(['too-deep .mcp.json']);
  });

  it('strips trailing commas in linear time', () => {
    const padded = `{"mcpServers":{},"x":[${'[0,],'.repeat(400_000)}0]} // a comment`;
    const started = performance.now();
    const stripped = stripJsonc(padded);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(stripped.startsWith('{"mcpServers":{},"x":[[0],[0],')).toBe(true);
    expect(stripJsonc('{"a": [1, 2,], /* x */ "b": "a,]" , }')).toBe('{"a": [1, 2],  "b": "a,]"  }');
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

describe('scripts that hooks run', () => {
  const hook = (command: string) => JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } });
  const scripts = (inventory: ReturnType<typeof scanInventory>) => inventory.components.find((c) => c.kind === 'hook')?.files?.map((f) => f.path);

  it('does not read a script link that leaves the project', (context) => {
    write('steal.sh', 'SECRET-OUTSIDE', outside);
    if (!linkFile(join(outside, 'steal.sh'), join(root, 'scripts/run.sh'))) return context.skip();
    write('.claude/settings.json', hook('./scripts/run.sh'));
    const inventory = scanInventory({ root });
    expect(JSON.stringify(inventory)).not.toContain('SECRET-OUTSIDE');
    expect(scripts(inventory)).toBeUndefined();
    expect(inventory.problems.map((p) => `${p.code} ${p.file}`)).toEqual(['outside-project scripts/run.sh']);
  });

  it('does not read a script through a folder link that leaves the project', (context) => {
    write('run.sh', 'SECRET-OUTSIDE', outside);
    try {
      symlinkSync(outside, join(root, 'tools'), 'dir');
    } catch {
      return context.skip();
    }
    write('.claude/settings.json', hook('bash tools/run.sh'));
    const inventory = scanInventory({ root });
    expect(JSON.stringify(inventory)).not.toContain('SECRET-OUTSIDE');
    expect(scripts(inventory)).toBeUndefined();
  });

  it('does not read a script outside the project by a relative path', () => {
    write('run.sh', 'SECRET-OUTSIDE', outside);
    write('.claude/settings.json', hook('../outside/run.sh && bash scripts/../../outside/run.sh'));
    const inventory = scanInventory({ root });
    expect(JSON.stringify(inventory)).not.toContain('SECRET-OUTSIDE');
    expect(scripts(inventory)).toBeUndefined();
  });

  it('does not read a script over the size limit, says so, and that fails the scan', () => {
    write('.claude/settings.json', hook('./scripts/big.sh'));
    write('scripts/big.sh', 'x'.repeat(2000));
    const inventory = scanInventory({ root, limits: { maxFileBytes: 1000 } });
    expect(scripts(inventory)).toEqual(['scripts/big.sh']);
    expect(inventory.components.find((c) => c.kind === 'hook')?.files?.[0]?.raw).toBeUndefined();
    expect(inventory.problems.map((p) => `${p.code} ${p.file}`)).toEqual(['too-large scripts/big.sh']);
  });

  it('leaves out installed packages and files the root .gitignore ignores', () => {
    write('.gitignore', '# build output\ndist/\n');
    write('.claude/settings.json', hook('node dist/hook.js && node node_modules/tool/cli.js && bash scripts/ok.sh'));
    write('dist/hook.js', 'built');
    write('node_modules/tool/cli.js', 'installed');
    write('scripts/ok.sh', 'echo ok');
    expect(scripts(scanInventory({ root }))).toEqual(['scripts/ok.sh']);
  });

  it('reads no script of a hook in the home directory', () => {
    const home = join(base, 'home');
    write('.claude/settings.json', hook('./scripts/run.sh'), home);
    write('scripts/run.sh', 'echo hi', root);
    const inventory = scanInventory({ root, user: true, home });
    expect(inventory.components.filter((c) => c.scope === 'user' && c.files !== undefined)).toEqual([]);
  });
});

describe('the scanner runs nothing', () => {
  it('leaves a command in a hook unexecuted', () => {
    const canary = join(base, 'canary');
    write('.claude/settings.json', JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node -e "require('fs').writeFileSync('${canary.replaceAll('\\', '/')}','x')"` }] }] } }));
    write('.claude/skills/a/SKILL.md', 'x');
    write('.claude/skills/a/run.sh', `#!/bin/sh\ntouch ${canary}\n`);
    chmodSync(join(root, '.claude/skills/a/run.sh'), 0o755);
    write('.claude/settings.local.json', JSON.stringify({ statusLine: { type: 'command', command: './scripts/status.sh' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: './scripts/status.sh' }] }] } }));
    write('scripts/status.sh', `#!/bin/sh\ntouch ${canary}\n`);
    chmodSync(join(root, 'scripts/status.sh'), 0o755);
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

describe('settings that name files or hold many entries', () => {
  it('reads at most 32 context file names, each a plain relative path, in bounded time', () => {
    const names = [...Array.from({ length: 5000 }, (_, index) => `n${index}.md`), 'x'.repeat(100_000), '**', '../../etc/passwd'];
    write('.gemini/settings.json', JSON.stringify({ context: { fileName: names } }));
    write('n1.md', '# one');
    write('n99.md', '# past the limit');
    const start = performance.now();
    const { components, problems } = scanInventory({ root });
    expect(performance.now() - start).toBeLessThan(3000);
    expect(components.filter((c) => c.kind === 'context-file').map((c) => c.file)).toEqual(['n1.md']);
    expect(problems.map((p) => `${p.code} ${p.file}`)).toEqual(['too-many-entries .gemini/settings.json']);
  });

  it('does not follow a context file name through a link out of the project', (context) => {
    write('secret.md', '# outside', outside);
    if (!linkFile(join(outside, 'secret.md'), join(root, 'AI.md'))) context.skip();
    write('.gemini/settings.json', JSON.stringify({ context: { fileName: 'AI.md' } }));
    const { components, problems } = scanInventory({ root });
    expect(components.some((c) => c.file === 'AI.md')).toBe(false);
    expect(problems.map((p) => p.code)).toContain('outside-project');
  });

  it('reads long env values and many marketplaces without slowing down', () => {
    const env = { ANTHROPIC_BASE_URL: `https://${'a'.repeat(1_000_000)}.example.com` };
    const extraKnownMarketplaces = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [`m${index}`, { source: { source: 'url', url: 'https://x.example/m.json', headersHelper: `./h${index}.sh` } }]));
    write('.claude/settings.json', JSON.stringify({ env, extraKnownMarketplaces }));
    const start = performance.now();
    const { components, problems } = scanInventory({ root });
    expect(performance.now() - start).toBeLessThan(3000);
    expect(components.filter((c) => c.kind === 'setting')).toHaveLength(257);
    expect(problems.map((p) => p.code)).toContain('too-many-entries');
  });
});

describe('script paths that pad the .gitignore match', () => {
  it('scans a hook with a very long script path and a long .gitignore in bounded time', () => {
    write('.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: `./${'a/'.repeat(4000)}s.sh` }] }] } }));
    write('.gitignore', Array.from({ length: 1000 }, (_, index) => `x${index}`).join('\n'));
    const start = performance.now();
    const { components } = scanInventory({ root });
    expect(performance.now() - start).toBeLessThan(3000);
    expect(components.filter((c) => c.kind === 'hook')).toHaveLength(1);
  });

  it('does not crash on deeply nested here-documents in a hook', () => {
    write('.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: `${'bash <<A\n'.repeat(8000)}./run.sh` }] }] } }));
    write('run.sh', 'echo hi');
    const { components } = scanInventory({ root });
    expect(components.filter((c) => c.kind === 'hook')).toHaveLength(1);
  });
});
