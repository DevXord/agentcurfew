import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanInventory } from '../../src/inventory/index.ts';
import { projectContext } from '../../src/lock/context.ts';
import { rules, runRules } from '../../src/rules/index.ts';
import type { Finding } from '../../src/rules/index.ts';
import { fixtureDir, materialize } from './materialize.ts';

const line = (finding: Finding) => `${finding.level} | ${finding.file}${finding.line === undefined ? '' : `:${finding.line}:${finding.column}`} | ${finding.name}`;

function findings(path: string, rule: string): Finding[] {
  const { root, cleanup } = materialize(path);
  try {
    return runRules(scanInventory({ root }), { context: projectContext(root).context }).filter((finding) => finding.rule === rule);
  } finally {
    cleanup();
  }
}

// Written by hand from each rule's description, one line per expected finding: level | file[:line:column] | component.
const POSITIVE: Readonly<Record<string, readonly string[]>> = {
  'hidden-unicode': [
    'critical | .mcp.json | docs',
    'critical | CLAUDE.md:3:15 | CLAUDE.md',
    'high | CLAUDE.md:4:6 | CLAUDE.md',
    'high | CLAUDE.md:4:14 | CLAUDE.md',
    'medium | CLAUDE.md:5:5 | CLAUDE.md',
  ],
  'unpinned-mcp-server': ['medium | .mcp.json | fs', 'medium | .mcp.json | gh', 'medium | .mcp.json | git', 'medium | .mcp.json | latest', 'medium | .mcp.json | next', 'medium | .mcp.json | range'],
  'plain-http-mcp': ['high | .cursor/mcp.json | remote', 'high | .gemini/settings.json | internal'],
  'secret-in-config': ['high | .claude/settings.json | Stop#0', 'high | .mcp.json | api', 'high | .mcp.json | cli', 'high | .mcp.json | github'],
  'dangerous-hook-command': ['high | .claude/settings.json | PreToolUse#0', 'high | .claude/settings.json | SessionStart#0', 'medium | .claude/settings.json | Stop#0', 'high | .cursor/hooks.json | afterFileEdit#0'],
  'auto-run-on-open': ['medium | .claude/settings.json | SessionStart#0', 'high | .cline/cron/nightly.md | nightly.md', 'high | .cursor/hooks.json | workspaceOpen#0', 'high | .vscode/tasks.json | setup'],
  'permission-bypass': ['low | .claude/settings.json | permissions.defaultMode', 'high | .codex/config.toml | approval_policy', 'high | .codex/config.toml | sandbox_mode', 'high | .cursor/permissions.json | mcpAllowlist'],
  'broad-shell-permission': ['medium | .claude/settings.json | permissions.allow', 'medium | .claude/skills/deploy/SKILL.md | deploy', 'medium | .gemini/settings.json | tools.allowed'],
  'remote-instructions': ['medium | .claude/skills/updater/SKILL.md:5:8 | updater', 'medium | .claude/skills/updater/scripts/run.py:3:8 | updater'],
  'obfuscated-content': ['high | .claude/skills/helper/bin/tool | helper', 'medium | .claude/skills/helper/scripts/blob.js:1:18 | helper', 'medium | .claude/skills/helper/scripts/min.js:1:1 | helper'],
  'persistence-instruction': ['low | .claude/skills/setup/SKILL.md:5:8 | setup'],
  drift: ['high | .mcp.json | fs', 'high | AGENTS.md | AGENTS.md', 'high | CLAUDE.md | CLAUDE.md', 'high | GEMINI.md | GEMINI.md'],
  'skills-lock-mismatch': ['medium | .claude/skills/lint/SKILL.md | lint', 'low | .claude/skills/py/SKILL.md | py', 'info | skills-lock.json | ghost'],
};

describe('rule fixtures', () => {
  it('exist for every rule, and only for rules', () => {
    expect(readdirSync(fixtureDir('')).sort()).toEqual(rules.map((rule) => rule.id).sort());
    for (const rule of rules) {
      expect(existsSync(fixtureDir(`${rule.id}/positive`)), rule.id).toBe(true);
      expect(existsSync(fixtureDir(`${rule.id}/negative`)), rule.id).toBe(true);
      expect(POSITIVE[rule.id], rule.id).toBeDefined();
    }
  });

  describe.each(rules.map((rule) => rule.id))('%s', (id) => {
    it('finds what the positive fixture holds', () => {
      expect(findings(`${id}/positive`, id).map(line)).toEqual(POSITIVE[id]);
    });

    it('finds nothing in the negative fixture', () => {
      expect(findings(`${id}/negative`, id).map((finding) => `${line(finding)} | ${finding.message}`)).toEqual([]);
    });
  });

  it('spells out hidden Tag characters', () => {
    const [tag] = findings('hidden-unicode/positive', 'hidden-unicode').filter((finding) => finding.file === 'CLAUDE.md');
    expect(tag?.message).toBe('6 hidden characters (Unicode Tag character): U+E0049 U+E0067 U+E006E U+E006F U+E0072 U+E0065; the Tag characters spell "Ignore"');
  });

  it('masks secrets and names the depcurfew check', () => {
    const secrets = findings('secret-in-config/positive', 'secret-in-config').map((finding) => finding.message);
    expect(secrets).toContain('GitHub token in plain text: ghp_… (40 characters)');
    expect(secrets.join('\n')).not.toMatch(/Ab1Ab1|Q7Q7|efgh1234|value-12345/);
    const unpinned = findings('unpinned-mcp-server/positive', 'unpinned-mcp-server').map((finding) => finding.message);
    expect(unpinned).toContain('the package mcp-server-git has no version, so every start may fetch a newer one');
    expect(unpinned.some((message) => message.endsWith('check it with npx depcurfew check @modelcontextprotocol/server-filesystem'))).toBe(true);
  });

  it('says when a fact behind a finding is uncertain', () => {
    const [cron] = findings('auto-run-on-open/positive', 'auto-run-on-open').filter((finding) => finding.file.startsWith('.cline/'));
    expect(cron?.message).toContain('marks this behaviour as uncertain');
    const [claude] = findings('permission-bypass/positive', 'permission-bypass').filter((finding) => finding.file.startsWith('.claude/'));
    expect(claude?.message).toContain('ignore it in a project file');
  });

  it('shows what drifted, with the old and new arguments', () => {
    const messages = findings('drift/positive', 'drift').map((finding) => `${finding.file}: ${finding.message}`);
    expect(messages).toEqual([
      '.mcp.json: changed since it was locked: args: ["-y","pkg@1.2.2"] -> ["-y","pkg@1.2.3"]',
      'AGENTS.md: in agentcurfew.lock, but no longer in the project',
      'CLAUDE.md: changed since it was locked: the content changed',
      'GEMINI.md: not in agentcurfew.lock: added since it was locked',
    ]);
  });

  it('names the known cause of a false skills-lock.json mismatch', () => {
    const [py] = findings('skills-lock-mismatch/positive', 'skills-lock-mismatch').filter((finding) => finding.name === 'py');
    expect(py?.message).toContain('__pycache__');
  });

  it('scans a fixture in under a second', () => {
    const { root, cleanup } = materialize('hidden-unicode/positive');
    try {
      const start = performance.now();
      runRules(scanInventory({ root }));
      expect(performance.now() - start).toBeLessThan(1000);
    } finally {
      cleanup();
    }
  });
});
