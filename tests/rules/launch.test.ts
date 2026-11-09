import { describe, expect, it } from 'vitest';
import type { Component } from '../../src/inventory/index.ts';
import { buildLock } from '../../src/lock/build.ts';
import { launch } from '../../src/rules/launch.ts';
import { mcpEntry } from '../../src/rules/mcp.ts';
import { rules, runRules } from '../../src/rules/index.ts';
import { knowledgeBase } from '../../src/knowledge/index.ts';

const hook = (command: string, extra: Partial<Component> = {}): Component => ({ kind: 'hook', agents: ['claude-code'], scope: 'project', file: '.claude/settings.json', name: 'PostToolUse#0', raw: JSON.stringify({ type: 'command', command }), ...extra });
const unpinned = (component: Component) => runRules({ components: [component], problems: [] }, { rules: rules.filter((rule) => rule.id === 'unpinned-launcher') });

describe('launchers, read as the launcher reads them', () => {
  it.each([
    [['npm', 'x', '-y', 'some-pkg'], 'some-pkg'],
    [['npm', 'exe', 'some-pkg'], 'some-pkg'],
    [['npm', '--yes', 'exec', 'some-pkg'], 'some-pkg'],
    [['npm', '--prefix', 'dir', 'exec', '--', 'some-pkg'], 'some-pkg'],
    [['pnpm', '--dir', 'x', 'dlx', 'some-pkg'], 'some-pkg'],
    [['docker', '--context', 'x', 'run', 'some-image'], 'some-image'],
    [['docker', '-H', 'tcp://h:2375', 'run', '--rm', 'some-image'], 'some-image'],
    [['npx', '--node-options', '--max-old-space-size=64', 'some-pkg'], 'some-pkg'],
    [['docker', 'run', '--cidfile', 'id.txt', '--volumes-from', 'other', 'some-image'], 'some-image'],
  ])('%j starts %s', (words, spec) => {
    expect(launch(words)?.spec).toBe(spec);
  });

  it('lists every package a launcher fetches, not only the last -p or the one it runs', () => {
    const fetched = (words: string[]) => launch(words)?.packages?.slice().sort();
    expect(fetched(['npx', '-p', 'some-pkg', '-p', 'other-pkg@1.0.0', 'tool'])).toEqual(['other-pkg@1.0.0', 'some-pkg']);
    expect(fetched(['uvx', '--with', 'some-pkg', 'black==24.1.0'])).toEqual(['black==24.1.0', 'some-pkg']);
    expect(fetched(['uvx', '--from', 'black==24.1.0', '--with=extra', 'black'])).toEqual(['black==24.1.0', 'extra']);
  });

  it('takes --no-install and --no as options of npx only before the package', () => {
    expect(launch(['npx', '--no-install', 'prettier'])?.noDownload).toBe(true);
    expect(launch(['npm', 'exec', '--no', '--', 'eslint'])?.noDownload).toBe(true);
    expect(launch(['npx', '-y', 'some-pkg', '--no'])?.noDownload).toBeUndefined();
  });
});

describe('unpinned-launcher against the evasions of the review of 2026-11-09', () => {
  it.each(['npm x -y some-pkg', 'npm --yes exec some-pkg', 'docker --context x run some-image', 'npx -y some-pkg --no', 'npx -p some-pkg -p other-pkg@1.0.0 tool', 'uvx --with some-pkg black==24.1.0', 'npx --node-options --max-old-space-size=64 some-pkg'])('%s is reported', (command) => {
    const found = unpinned(hook(command));
    expect(found.map((finding) => finding.message).join('\n')).toMatch(/some-(?:pkg|image)/);
  });

  it('still leaves npx --no-install and pinned packages alone', () => {
    expect(unpinned(hook('npx --no-install prettier --check .'))).toEqual([]);
    expect(unpinned(hook('npx -p some-pkg@1.2.3 -p other-pkg@1.0.0 tool'))).toEqual([]);
  });
});

describe('MCP servers whatever their name', () => {
  const server = (name: string): Component => ({ kind: 'mcp-server', agents: ['claude-code'], scope: 'project', file: '.mcp.json', name, raw: JSON.stringify({ command: 'npx', args: ['-y', 'some-pkg'] }) });

  it('reads a server named like its file as an entry, for the rules and the lock', () => {
    for (const name of ['.mcp.json', 'srv']) {
      const found = runRules({ components: [server(name)], problems: [] }).filter((finding) => finding.rule === 'unpinned-mcp-server');
      expect(found, name).toHaveLength(1);
      expect(buildLock({ components: [server(name)], problems: [] }).components[0]?.server?.package?.name, name).toBe('some-pkg');
    }
  });

  it('keeps a __proto__ key of env as a variable, not as the prototype', () => {
    const component: Component = { ...server('x'), raw: '{"command":"node","env":{"__proto__":{"API_TOKEN":"x"},"OTHER":"y"}}' };
    const entry = mcpEntry(component, knowledgeBase);
    expect(Object.keys(entry?.env ?? {}).sort()).toEqual(['OTHER', '__proto__']);
    expect(Object.getPrototypeOf(entry?.env)).toBeNull();
  });
});
