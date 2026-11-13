import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linkDirectory } from '../support/links.ts';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checks } from '../../src/doctor/checks.ts';
import { runDoctor } from '../../src/doctor/index.ts';
import { renderDoctor } from '../../src/doctor/render.ts';
import { rules } from '../../src/rules/index.ts';
import { getVersion } from '../../src/version.ts';

const fixture = (path: string) => fileURLToPath(new URL(`../fixtures/doctor/${path}`, import.meta.url));

function hits(path: string, id: string): string[] {
  const check = checks.find((candidate) => candidate.id === id);
  if (check === undefined) throw new Error(id);
  return runDoctor(fixture(path), { only: [check] }).results.flatMap((result) => result.hits.map((hit) => `${hit.level} | ${hit.file} | ${hit.message}`));
}

// Written by hand from each check's description.
const NEWER = `is not a known value in agentcurfew ${getVersion()}; this file may have been written by a newer agentcurfew (upgrade, or remove it).`;
const NEWER_FIELD = `is not a known setting in agentcurfew ${getVersion()}; this file may have been written by a newer agentcurfew (upgrade, or remove it).`;
const POSITIVE: Readonly<Record<string, readonly string[]>> = {
  'invalid-policy': [
    `error | agentcurfew.policy.json | policy.exceptions[0].rule: "Bad Rule" ${NEWER}`,
    'error | agentcurfew.policy.json | policy.exceptions[0].until: expected a date written YYYY-MM-DD',
    'error | agentcurfew.policy.json | policy.mcp.allowServers[1]: expected a string, got a number',
    `error | agentcurfew.policy.json | policy.unknown: ${NEWER_FIELD}`,
  ],
  'unparsable-config': ['error | .claude/skills/x/SKILL.md | could not be parsed, so nothing in it was read', 'error | .mcp.json | could not be parsed, so nothing in it was read'],
  'misnamed-file': [
    'warning | .claude/setting.json | setting.json looks like a misspelling of settings.json, which is the name agents read',
    'warning | .mcp.jsonc | .mcp.jsonc has the extension .jsonc, but agents read .mcp.json',
    'warning | Claude.md | Claude.md differs from CLAUDE.md only in case, so agents on a case-sensitive file system do not read it',
  ],
  'wrong-servers-key': [
    'error | .mcp.json | holds servers, but Claude Code, GitHub Copilot in VS Code read mcpServers here, so no server is configured',
    'error | .vscode/mcp.json | holds mcpServers, but GitHub Copilot in VS Code reads servers here, so no server is configured',
  ],
  'missing-mcp-type': ['error | .mcp.json | the server remote has a url but no type, so Claude Code reads it as a local server'],
  'local-overrides-project': ['warning | .claude/settings.json | permissions.defaultMode is set here, but .claude/settings.local.json sets it to another value and wins for Claude Code'],
  'conflicting-mcp-server': ['warning | .vscode/mcp.json | the server docs is also defined in .mcp.json, differently, and copilot-vscode reads both'],
  'unknown-hook-event': [
    'warning | .claude/settings.json | post-tool-use is not a hook event of Claude Code, Cursor, GitHub Copilot in VS Code, Windsurf (Devin Desktop), so its hooks never run; did you mean PostToolUse?',
  ],
  'deprecated-format': [
    'warning | .cursorrules | Cursor calls .cursorrules deprecated; use rules in .cursor/rules/*.mdc',
    'info | .gemini/settings.json | Gemini CLI calls httpUrl of the server old deprecated; use url with type http',
    'warning | .gemini/settings.json | Gemini CLI calls tools.exclude deprecated; use deny rules of the policy engine',
    'warning | .windsurf/skills/lint/SKILL.md | Windsurf (Devin Desktop) calls .windsurf/skills/lint/SKILL.md deprecated; use .devin/skills/<name>/',
    'warning | .windsurfrules | Windsurf (Devin Desktop) calls .windsurfrules deprecated; use rules in .devin/rules/*.md, or .devin/global_rules.md',
  ],
  'stale-policy-entry': [
    'info | agentcurfew.policy.json | exceptions[0] (hidden-unicode on nothing/**) matches no finding',
    'info | agentcurfew.policy.json | mcp.allowServers[0] (ghost-server) matches no server of the project',
    'info | agentcurfew.policy.json | skills.allowSources[0] (github:none/*) matches no skill of the project',
  ],
  'depcurfew-hook-missing': ['warning | depcurfew.json | the project has a depcurfew policy, but no depcurfew hook in the Claude Code settings of the project, so installs by the agent are not checked'],
  'depcurfew-hook-broken': ['error | .claude/settings.json | the depcurfew hook PreToolUse#0 runs node_modules/depcurfew/dist/cli.js, which does not exist, and with onFailure "block" every command it covers is blocked'],
  'agentcurfew-hook-missing': ['warning | .claude/settings.json | the hook PreToolUse#0 runs node_modules/agentcurfew/dist/cli.js, which does not exist in this project, so it checks nothing'],
  'hooks-disabled': ['error | .claude/settings.json | disableAllHooks is true, so Claude Code runs no hook of the user, the project, local settings or plugins, no status line and no file suggestion command, and the depcurfew and agentcurfew hooks of this file check nothing'],
};

describe('doctor checks', () => {
  it('have fixtures, and only checks do', () => {
    expect(readdirSync(fixture('')).sort()).toEqual(checks.map((check) => check.id).sort());
    for (const check of checks) {
      expect(existsSync(fixture(`${check.id}/positive`)), check.id).toBe(true);
      expect(existsSync(fixture(`${check.id}/negative`)), check.id).toBe(true);
      expect(POSITIVE[check.id], check.id).toBeDefined();
    }
  });

  describe.each(checks.map((check) => check.id))('%s', (id) => {
    it('finds what the positive fixture holds', () => expect(hits(`${id}/positive`, id)).toEqual(POSITIVE[id]));
    it('finds nothing in the negative fixture', () => expect(hits(`${id}/negative`, id)).toEqual([]));
  });

  it('give an https source for every finding', () => {
    for (const check of checks) {
      for (const result of runDoctor(fixture(`${check.id}/positive`), { only: [check] }).results) {
        for (const hit of result.hits) {
          expect(hit.sources.length, `${check.id}: ${hit.message}`).toBeGreaterThan(0);
          for (const source of hit.sources) expect(new URL(source).protocol).toBe('https:');
        }
      }
    }
  });

  it('are complete, with unique ids', () => {
    expect(new Set(checks.map((check) => check.id)).size).toBe(checks.length);
    for (const check of checks) {
      expect(check.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      for (const text of [check.title, check.description, check.fix]) expect(text.length).toBeGreaterThan(10);
    }
  });

  it('are documented in docs/doctor.md, which is up to date (run npm run docs:doctor)', () => {
    const file = readFileSync(new URL('../../docs/doctor.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
    expect(file).toBe(renderDoctor());
  });
});

describe('policy schema', () => {
  it('lists every rule id, and only those, for exceptions', () => {
    const schema = JSON.parse(readFileSync(new URL('../../schema.json', import.meta.url), 'utf8')) as { properties: { exceptions: { items: { properties: { rule: { enum: string[] } } } } } };
    expect(schema.properties.exceptions.items.properties.rule.enum).toEqual(rules.map((rule) => rule.id));
  });
});

describe('doctor and links', () => {
  it('does not read through a folder that links out of the project', () => {
    const base = mkdtempSync(join(tmpdir(), 'acf-doctor-link-'));
    try {
      mkdirSync(join(base, 'project'));
      mkdirSync(join(base, 'outside'));
      writeFileSync(join(base, 'outside', 'mcp.json'), JSON.stringify({ servers: { x: { command: 'node' } } }));
      linkDirectory(join(base, 'outside'), join(base, 'project', '.cursor'));
      const check = checks.find((candidate) => candidate.id === 'wrong-servers-key');
      if (check === undefined) throw new Error('wrong-servers-key');
      const found = runDoctor(join(base, 'project'), { only: [check] }).results.flatMap((result) => result.hits);
      expect(found).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('tools-folder layout (depcurfew 1.3.0+)', () => {
  function project(name: string, hookArg: string): { base: string; root: string } {
    const base = mkdtempSync(join(tmpdir(), `acf-doctor-${name}-`));
    const root = join(base, 'project');
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      join(root, '.claude/settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{
            matcher: 'Bash|PowerShell|Monitor',
            hooks: [{ type: 'command', command: 'node', args: [hookArg, 'check', '--hook', 'claude-code'], onFailure: 'block' }],
          }],
        },
      }, null, 2),
    );
    return { base, root };
  }

  function hits(root: string, id: string): string[] {
    const check = checks.find((candidate) => candidate.id === id);
    if (check === undefined) throw new Error(id);
    return runDoctor(root, { only: [check] }).results.flatMap((result) => result.hits.map((hit) => `${hit.level} | ${hit.file} | ${hit.message}`));
  }

  it('accepts depcurfew installed under .claude/depcurfew/node_modules (the README of depcurfew)', () => {
    const { base, root } = project('tools-folder-ok', '${CLAUDE_PROJECT_DIR}/.claude/depcurfew/node_modules/depcurfew/dist/cli.js');
    try {
      mkdirSync(join(root, '.claude/depcurfew/node_modules/depcurfew/dist'), { recursive: true });
      writeFileSync(join(root, '.claude/depcurfew/node_modules/depcurfew/dist/cli.js'), '// stub');
      expect(hits(root, 'depcurfew-hook-broken')).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('reports the tools-folder layout as missing when the file is not there', () => {
    const { base, root } = project('tools-folder-missing', '${CLAUDE_PROJECT_DIR}/.claude/depcurfew/node_modules/depcurfew/dist/cli.js');
    try {
      const found = hits(root, 'depcurfew-hook-broken');
      expect(found).toHaveLength(1);
      expect(found[0]).toContain('.claude/depcurfew/node_modules/depcurfew/dist/cli.js');
      expect(found[0]).toContain('does not exist');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('refuses a hook that would resolve outside the project', () => {
    const { base, root } = project('tools-folder-escape', '${CLAUDE_PROJECT_DIR}/../x/node_modules/depcurfew/dist/cli.js');
    try {
      // The path escapes the project; we must not probe or claim it.
      expect(hits(root, 'depcurfew-hook-broken')).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('accepts the agentcurfew hook under the same layout for agentcurfew-hook-missing', () => {
    const { base, root } = project('agentcurfew-tools-folder', '${CLAUDE_PROJECT_DIR}/.claude/agentcurfew/node_modules/agentcurfew/dist/cli.js');
    try {
      mkdirSync(join(root, '.claude/agentcurfew/node_modules/agentcurfew/dist'), { recursive: true });
      writeFileSync(join(root, '.claude/agentcurfew/node_modules/agentcurfew/dist/cli.js'), '// stub');
      // Rewrite handler to call `hook` rather than `check --hook claude-code`, so isOwnHook() matches.
      const settingsPath = join(root, '.claude/settings.json');
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { hooks: { PreToolUse: { hooks: { args: string[] }[] }[] } };
      settings.hooks.PreToolUse[0]!.hooks[0]!.args = ['${CLAUDE_PROJECT_DIR}/.claude/agentcurfew/node_modules/agentcurfew/dist/cli.js', 'hook'];
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      expect(hits(root, 'agentcurfew-hook-missing')).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
