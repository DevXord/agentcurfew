import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanInventory } from '../../src/inventory/index.ts';
import type { Component } from '../../src/inventory/index.ts';
import { publicComponent } from '../../src/cli/scan.ts';

// The gaps that D-011 left for phase 3.
let base: string;
let root: string;
let home: string;

function write(path: string, text: string | Buffer, at = root): void {
  mkdirSync(dirname(join(at, path)), { recursive: true });
  writeFileSync(join(at, path), text);
}

const line = (c: Component) => `${c.kind} | ${c.file} | ${c.name}`;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'acf-gaps-'));
  root = join(base, 'project');
  home = join(base, 'home');
  mkdirSync(root);
  mkdirSync(home);
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

const SKILL_HOOKS = `---
name: guard
description: Guards edits.
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: ./check.sh
  SessionStart:
    - hooks:
        - type: command
          command: ./start.sh
---
Body.
`;

describe('inventory gaps closed in phase 3', () => {
  it('lists hooks from skill and subagent frontmatter', () => {
    write('.claude/skills/guard/SKILL.md', SKILL_HOOKS);
    write('.claude/agents/reviewer.md', '---\nname: reviewer\nhooks:\n  Stop:\n    - hooks:\n        - type: command\n          command: ./done.sh\n---\nReview.\n');
    const lines = scanInventory({ root }).components.filter((c) => c.kind === 'hook' || c.kind === 'auto-run').map(line);
    expect(lines).toEqual([
      'auto-run | .claude/skills/guard/SKILL.md | SessionStart#0',
      'hook | .claude/agents/reviewer.md | Stop#0',
      'hook | .claude/skills/guard/SKILL.md | PreToolUse#0',
      'hook | .claude/skills/guard/SKILL.md | SessionStart#0',
    ]);
  });

  it('reports frontmatter it cannot parse or that is too large, and goes on', () => {
    write('.claude/skills/bad/SKILL.md', '---\nname: bad\nname: twice\n---\n');
    write('.claude/skills/big/SKILL.md', `---\nname: big\ndescription: "${'x'.repeat(40_000)}"\n---\n`);
    const { components, problems } = scanInventory({ root });
    expect(problems).toEqual([
      { code: 'unparsable', file: '.claude/skills/bad/SKILL.md' },
      { code: 'too-large', file: '.claude/skills/big/SKILL.md' },
    ]);
    expect(components.filter((c) => c.kind === 'skill').map((c) => c.name)).toEqual(['bad', 'big']);
  });

  it('reads local-scope MCP servers of this project only from ~/.claude.json', () => {
    const projects = { [root]: { mcpServers: { mine: { command: 'node', args: ['a.js'] } } }, [join(base, 'other')]: { mcpServers: { theirs: { command: 'node' } } } };
    write('.claude.json', JSON.stringify({ mcpServers: { global: { command: 'node' } }, projects }), home);
    const servers = scanInventory({ root, home, user: true, platform: 'linux' }).components.filter((c) => c.kind === 'mcp-server');
    expect(servers.map(line)).toEqual(['mcp-server | ~/.claude.json | global', 'mcp-server | ~/.claude.json | mine']);
    expect(scanInventory({ root, home }).components).toEqual([]);
  });

  it('lists Gemini CLI policy rules as permissions', () => {
    write('.gemini/policies/team.toml', '[[rule]]\ntoolName = "run_shell_command"\ndecision = "allow"\npriority = 100\n', home);
    const permissions = scanInventory({ root, home, user: true, platform: 'linux' }).components.filter((c) => c.kind === 'permission');
    expect(permissions.map(line)).toEqual(['permission | ~/.gemini/policies/team.toml | rule']);
  });

  it('lists Cursor workspaceOpen hooks as auto-run', () => {
    write('.cursor/hooks.json', JSON.stringify({ version: 1, hooks: { workspaceOpen: [{ command: './go.sh' }], stop: [{ command: './stop.sh' }] } }));
    const autoRun = scanInventory({ root }).components.filter((c) => c.kind === 'auto-run');
    expect(autoRun.map(line)).toEqual(['auto-run | .cursor/hooks.json | workspaceOpen#0']);
  });

  it('types the files of a skill and keeps their contents out of the output', () => {
    write('.claude/skills/kit/SKILL.md', '---\nname: kit\ndescription: Kit.\n---\n');
    write('.claude/skills/kit/run.sh', 'echo secret-text\n');
    write('.claude/skills/kit/tool', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]));
    write('.claude/skills/kit/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    write('.claude/skills/kit/data.bin', Buffer.from([1, 2, 0, 3]));
    const [skill] = scanInventory({ root }).components.filter((c) => c.kind === 'skill');
    expect(skill?.files?.map((file) => `${file.path} ${file.type}`)).toEqual(['SKILL.md text', 'data.bin binary', 'logo.png media', 'run.sh text', 'tool executable']);
    const printed = JSON.stringify(publicComponent(skill as Component));
    expect(printed).not.toContain('secret-text');
    expect(printed).not.toContain('"type"');
  });
});
