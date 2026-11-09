import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanInventory } from '../../src/inventory/index.ts';
import type { Component } from '../../src/inventory/index.ts';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/repos/${name}`, import.meta.url));
const line = (c: Component) => `${c.kind} | ${c.file} | ${c.name} | ${c.agents.join(',')}`;

const CLAUDE_HOOK = 'claude-code,copilot-vscode,cursor,windsurf';
const VSCODE_TASK = 'copilot-vscode,cursor,windsurf';
const AGENTS_MD = 'claude-code,cline,codex,copilot-vscode,cursor,windsurf';
const AGENTS_SKILL = 'cline,codex,copilot-vscode,cursor,gemini-cli,windsurf';

// Written by hand from src/knowledge/, not from the scanner's output.
const EXPECTED: Readonly<Record<string, readonly string[]>> = {
  empty: [],
  'claude-basic': [
    'auto-run | .claude/settings.json | SessionStart#0 | claude-code',
    'command | .claude/commands/ship.md | ship.md | claude-code',
    'context-file | CLAUDE.md | CLAUDE.md | claude-code,copilot-vscode,cursor',
    `hook | .claude/settings.json | PreToolUse#0 | ${CLAUDE_HOOK}`,
    `hook | .claude/settings.json | PreToolUse#1 | ${CLAUDE_HOOK}`,
    `hook | .claude/settings.json | SessionStart#0 | ${CLAUDE_HOOK}`,
    'mcp-server | .mcp.json | docs | claude-code,copilot-vscode',
    'permission | .claude/settings.json | permissions.allow | claude-code',
    'permission | .claude/settings.json | permissions.defaultMode | claude-code',
    'skill | .claude/skills/lint/SKILL.md | lint | claude-code,cline,cursor',
    'subagent | .claude/agents/reviewer.md | reviewer.md | claude-code,copilot-vscode,cursor',
  ],
  'claude-commands': [
    'auto-run | .claude/settings.json | statusLine | claude-code',
    'command-setting | .claude/settings.json | apiKeyHelper | claude-code',
    'command-setting | .claude/settings.json | fileSuggestion | claude-code',
    'command-setting | .claude/settings.json | statusLine | claude-code',
    `hook | .claude/settings.json | PostToolUse#0 | ${CLAUDE_HOOK}`,
    `hook | .claude/settings.json | Stop#0 | ${CLAUDE_HOOK}`,
  ],
  'cursor-basic': [
    'context-file | .cursor/rules/style.mdc | style.mdc | cline,cursor',
    'context-file | .cursorrules | .cursorrules | cline,cursor',
    'hook | .cursor/hooks.json | afterFileEdit#0 | cursor',
    'mcp-server | .cursor/mcp.json | db | cursor',
    'permission | .cursor/permissions.json | mcpAllowlist | cursor',
    'subagent | .cursor/agents/helper.md | helper.md | cursor',
  ],
  'codex-toml': [
    'auto-run | .codex/config.toml | SessionStart#0 | codex',
    `context-file | AGENTS.md | AGENTS.md | ${AGENTS_MD}`,
    'hook | .codex/config.toml | SessionStart#0 | codex',
    'mcp-server | .codex/config.toml | docs | codex',
    'mcp-server | .codex/config.toml | my server | codex',
    'permission | .codex/config.toml | approval_policy | codex',
    'permission | .codex/config.toml | mcp_servers.docs.default_tools_approval_mode | codex',
    'permission | .codex/config.toml | sandbox_mode | codex',
    'permission | .codex/rules/default.rules | default.rules | codex',
    `skill | .agents/skills/fmt/SKILL.md | fmt | ${AGENTS_SKILL}`,
    'subagent | .codex/agents/reviewer.toml | reviewer.toml | codex',
  ],
  'gemini-basic': [
    'command | .gemini/commands/deploy.toml | deploy.toml | gemini-cli',
    'command | .gemini/commands/git/commit.toml | commit.toml | gemini-cli',
    'context-file | GEMINI.md | GEMINI.md | gemini-cli',
    'hook | .gemini/settings.json | BeforeTool#0 | gemini-cli',
    'mcp-server | .gemini/settings.json | search | gemini-cli',
    'permission | .gemini/settings.json | general.defaultApprovalMode | gemini-cli',
    'permission | .gemini/settings.json | tools.allowed | gemini-cli',
    'subagent | .gemini/agents/helper.md | helper.md | gemini-cli',
  ],
  'copilot-vscode': [
    'command | .github/prompts/review.prompt.md | review.prompt.md | copilot-vscode',
    'context-file | .github/copilot-instructions.md | copilot-instructions.md | copilot-vscode',
    'context-file | .github/instructions/ts.instructions.md | ts.instructions.md | copilot-vscode',
    'hook | .github/hooks/guard.json | PreToolUse#0 | copilot-vscode',
    'mcp-server | .vscode/mcp.json | fetch | copilot-vscode',
    'permission | .vscode/settings.json | chat.tools.global.autoApprove | copilot-vscode',
    'skill | .github/skills/notes/SKILL.md | notes | copilot-vscode',
    'subagent | .github/agents/planner.md | planner.md | copilot-vscode',
  ],
  'vscode-tasks': [`auto-run | .vscode/tasks.json | on-open | ${VSCODE_TASK}`, `auto-run | .vscode/tasks.json | task#2 | ${VSCODE_TASK}`],
  'portable-mcp': ['mcp-server | .mcp.json | first | claude-code,copilot-vscode', 'mcp-server | .mcp.json | second | claude-code,copilot-vscode'],
  'windsurf-current': [
    'context-file | .devin/rules/style.md | style.md | windsurf',
    'hook | .devin/config.json | Stop#0 | windsurf',
    'hook | .devin/hooks.v1.json | PreToolUse#0 | windsurf',
    'mcp-server | .devin/mcp_config.json | tracker | windsurf',
    'permission | .devin/config.json | permissions.allow | windsurf',
    'skill | .devin/skills/notes/SKILL.md | notes | windsurf',
    'subagent | .devin/agents/helper.md | helper.md | windsurf',
  ],
  'windsurf-legacy': [
    'command | .windsurf/workflows/release.md | release.md | windsurf',
    'context-file | .windsurf/rules/style.md | style.md | windsurf',
    'context-file | .windsurfrules | .windsurfrules | cline,windsurf',
  ],
  cline: [
    'auto-run | .cline/cron/nightly.md | nightly.md | cline',
    'command | .clinerules/workflows/release.md | release.md | cline',
    'context-file | .clinerules/style.md | style.md | cline',
    'hook | .clinerules/hooks/PreToolUse | PreToolUse | cline',
    'skill | .cline/skills/two/SKILL.md | two | cline',
    'skill | .clinerules/skills/one/SKILL.md | one | cline',
    'subagent | .cline/agents/helper.md | helper.md | cline',
  ],
  'cline-single-file': ['context-file | .clinerules | .clinerules | cline'],
  'multi-agent': [
    `context-file | AGENTS.md | AGENTS.md | ${AGENTS_MD}`,
    'context-file | CLAUDE.md | CLAUDE.md | claude-code,copilot-vscode,cursor',
    'mcp-server | .cursor/mcp.json | shared | cursor',
    'mcp-server | .mcp.json | shared | claude-code,copilot-vscode',
  ],
  monorepo: [
    'context-file | packages/a/AGENTS.md | AGENTS.md | claude-code,codex,copilot-vscode,cursor,windsurf',
    'context-file | packages/b/CLAUDE.md | CLAUDE.md | claude-code',
    'context-file | packages/c/src/deep/GEMINI.md | GEMINI.md | gemini-cli',
    'permission | packages/a/.codex/config.toml | approval_policy | codex',
  ],
  'invalid-config': ['context-file | CLAUDE.md | CLAUDE.md | claude-code,copilot-vscode,cursor', 'mcp-server | .cursor/mcp.json | good | cursor'],
  'hostile-keys': [
    'mcp-server | .codex/config.toml | __proto__ | codex',
    'mcp-server | .mcp.json | __proto__ | claude-code,copilot-vscode',
    'mcp-server | .mcp.json | constructor | claude-code,copilot-vscode',
  ],
  secrets: [`hook | .claude/settings.json | Stop#0 | ${CLAUDE_HOOK}`, 'mcp-server | .mcp.json | api | claude-code,copilot-vscode'],
};

describe('inventory of fixtures', () => {
  it('has at least 15 fixtures', () => {
    expect(Object.keys(EXPECTED).length).toBeGreaterThanOrEqual(15);
  });

  it.each(Object.entries(EXPECTED))('%s', (name, expected) => {
    const inventory = scanInventory({ root: fixture(name) });
    expect(inventory.components.map(line).sort()).toEqual([...expected].sort());
  });

  it('reports a file it cannot parse and carries on', () => {
    const { problems } = scanInventory({ root: fixture('invalid-config') });
    expect(problems.map((p) => `${p.code} ${p.file}`).sort()).toEqual(['unparsable .codex/config.toml', 'unparsable .mcp.json']);
  });

  it('reports no problems for healthy fixtures', () => {
    expect(scanInventory({ root: fixture('claude-basic') }).problems).toEqual([]);
  });

  it('marks only the hooks that start on their own', () => {
    const hooks = scanInventory({ root: fixture('claude-basic') }).components.filter((c) => c.kind === 'hook' || c.kind === 'auto-run');
    expect(hooks.filter((c) => c.kind === 'auto-run').map((c) => c.name)).toEqual(['SessionStart#0']);
  });

  it('keeps the raw entry for analysis, including commands', () => {
    const { components } = scanInventory({ root: fixture('copilot-vscode') });
    expect(components.find((c) => c.kind === 'hook')?.raw).toContain('"powershell"');
    expect(components.find((c) => c.kind === 'mcp-server')?.raw).toContain('fetch-server==1.0.0');
    expect(components.find((c) => c.kind === 'skill')?.raw).toContain('name: notes');
  });

  it('lists the files of a skill folder', () => {
    const skill = scanInventory({ root: fixture('claude-basic') }).components.find((c) => c.kind === 'skill');
    expect(skill?.files?.map((f) => f.path)).toEqual(['SKILL.md', 'scripts/run.sh']);
  });

  it('reads the scripts that hooks and command settings run, inside the project only', () => {
    const { components, problems } = scanInventory({ root: fixture('claude-commands') });
    const scripts = (kind: string, name: string) => components.find((c) => c.kind === kind && c.name === name)?.files?.map((f) => f.path);
    expect(scripts('hook', 'PostToolUse#0')).toEqual(['.claude/hooks/check.py']);
    expect(scripts('command-setting', 'statusLine')).toEqual(['.claude/statusline.sh']);
    expect(scripts('auto-run', 'statusLine')).toEqual(['.claude/statusline.sh']);
    expect(scripts('command-setting', 'apiKeyHelper')).toEqual(['.claude/hooks/key.py']);
    // A home path, a missing file, a parent folder, an absolute path and a variable are not read.
    expect(scripts('command-setting', 'fileSuggestion')).toBeUndefined();
    expect(scripts('hook', 'Stop#0')).toBeUndefined();
    expect(components.find((c) => c.name === 'PostToolUse#0')?.filesRoot).toBe('project');
    expect(components.find((c) => c.name === 'PostToolUse#0')?.files?.[0]?.raw).toContain('checked');
    expect(problems).toEqual([]);
  });

  it('leaves out command settings an agent ignores in a project file', () => {
    // Codex ignores notify in .codex/config.toml (PROJECT_LOCAL_CONFIG_DENYLIST).
    const { components } = scanInventory({ root: fixture('claude-commands') });
    expect(components.filter((c) => c.agents.includes('codex'))).toEqual([]);
  });

  it('gives the same result twice, in a stable order', () => {
    expect(scanInventory({ root: fixture('multi-agent') })).toEqual(scanInventory({ root: fixture('multi-agent') }));
  });
});
