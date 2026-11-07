import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checks } from '../../src/doctor/checks.ts';
import { runDoctor } from '../../src/doctor/index.ts';
import { renderDoctor } from '../../src/doctor/render.ts';

const fixture = (path: string) => fileURLToPath(new URL(`../fixtures/doctor/${path}`, import.meta.url));

function hits(path: string, id: string): string[] {
  const check = checks.find((candidate) => candidate.id === id);
  if (check === undefined) throw new Error(id);
  return runDoctor(fixture(path), { only: [check] }).results.flatMap((result) => result.hits.map((hit) => `${hit.level} | ${hit.file} | ${hit.message}`));
}

// Written by hand from each check's description.
const POSITIVE: Readonly<Record<string, readonly string[]>> = {
  'invalid-policy': [
    'error | agentcurfew.policy.json | policy.exceptions[0].rule: does not have the expected form',
    'error | agentcurfew.policy.json | policy.exceptions[0].until: expected a date written YYYY-MM-DD',
    'error | agentcurfew.policy.json | policy.mcp.allowServers[1]: expected a string, got a number',
    'error | agentcurfew.policy.json | policy.unknown: is not a known setting',
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
