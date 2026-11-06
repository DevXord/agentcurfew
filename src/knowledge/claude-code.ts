import { verifiedOn } from './define.ts';
import type { AgentKnowledge, AgentPath, ContextFile, FileFormat, HooksKnowledge, PermissionsKnowledge } from './types.ts';

const { verified, disputed, evidence } = verifiedOn('2026-11-06');

const DOCS = 'https://code.claude.com/docs/en';
const SETTINGS = `${DOCS}/settings`;
const SETTINGS_REFERENCE = `${DOCS}/settings-reference`;
const MANAGED = `${DOCS}/managed-settings`;
const MCP = `${DOCS}/mcp`;
const HOOKS = `${DOCS}/hooks`;
const SKILLS = `${DOCS}/skills`;
const MEMORY = `${DOCS}/memory`;
const PERMISSIONS = `${DOCS}/permissions`;
const SUB_AGENTS = `${DOCS}/sub-agents`;
const DIRECTORY = `${DOCS}/claude-directory`;

// Managed files are absolute system paths, which AgentPath.path does not describe; Windows paths use / like every other path here.
const SYSTEM_DIRECTORIES = [
  { directory: '/Library/Application Support/ClaudeCode', platforms: ['darwin'] },
  { directory: '/etc/claude-code', platforms: ['linux'] },
  { directory: 'C:/Program Files/ClaudeCode', platforms: ['win32'] },
] as const;

function managed(name: string, format: FileFormat): AgentPath[] {
  return SYSTEM_DIRECTORIES.map(({ directory, platforms }) => ({ path: `${directory}/${name}`, scope: 'managed', format, platforms }));
}

const MANAGED_SETTINGS: readonly AgentPath[] = [...managed('managed-settings.d/*.json', 'json'), ...managed('managed-settings.json', 'json')];
const LOCAL_SETTINGS: AgentPath = { path: '.claude/settings.local.json', scope: 'project', format: 'json' };
const PROJECT_SETTINGS: AgentPath = { path: '.claude/settings.json', scope: 'project', format: 'json' };
const USER_SETTINGS: AgentPath = { path: '~/.claude/settings.json', scope: 'user', format: 'json' };
const SETTINGS_FILES = [...MANAGED_SETTINGS, LOCAL_SETTINGS, PROJECT_SETTINGS, USER_SETTINGS];

const FRONTMATTER_HOOKS: readonly AgentPath[] = [
  { path: '.claude/skills/*/SKILL.md', scope: 'project', format: 'markdown-frontmatter' },
  { path: '~/.claude/skills/*/SKILL.md', scope: 'user', format: 'markdown-frontmatter' },
  { path: '.claude/agents/*.md', scope: 'project', format: 'markdown-frontmatter' },
  { path: '~/.claude/agents/*.md', scope: 'user', format: 'markdown-frontmatter' },
];

const hooks: HooksKnowledge = {
  files: [...SETTINGS_FILES, ...FRONTMATTER_HOOKS],
  key: 'hooks',
  events: [
    'SessionStart', 'Setup', 'UserPromptSubmit', 'UserPromptExpansion', 'PreToolUse', 'PermissionRequest', 'PermissionDenied',
    'PostToolUse', 'PostToolUseFailure', 'PostToolBatch', 'Notification', 'MessageDisplay', 'SubagentStart', 'SubagentStop',
    'TaskCreated', 'TaskCompleted', 'Stop', 'StopFailure', 'TeammateIdle', 'InstructionsLoaded', 'ConfigChange', 'CwdChanged',
    'DirectoryAdded', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove', 'PreCompact', 'PostCompact', 'PreModelSwitch',
    'PostModelSwitch', 'Elicitation', 'ElicitationResult', 'SessionEnd',
  ],
  handlerTypes: ['command', 'http', 'mcp_tool', 'prompt', 'agent'],
  commandField: 'command',
};

const contextFiles: readonly ContextFile[] = [
  { path: 'CLAUDE.md', scope: 'project', format: 'markdown', loading: 'always' },
  { path: '.claude/CLAUDE.md', scope: 'project', format: 'markdown', loading: 'always' },
  { path: 'CLAUDE.local.md', scope: 'project', format: 'markdown', loading: 'always' },
  { path: '~/.claude/CLAUDE.md', scope: 'user', format: 'markdown', loading: 'always' },
  ...managed('CLAUDE.md', 'markdown').map((file): ContextFile => ({ ...file, loading: 'always' })),
  { path: '~/.claude/projects/*/memory/MEMORY.md', scope: 'user', format: 'markdown', loading: 'always' },
  { path: 'AGENTS.md', scope: 'project', format: 'markdown', loading: 'conditional' },
  { path: '.claude/AGENTS.md', scope: 'project', format: 'markdown', loading: 'conditional' },
  { path: '.claude/rules/**/*.md', scope: 'project', format: 'markdown-frontmatter', loading: 'conditional' },
  { path: '~/.claude/rules/**/*.md', scope: 'user', format: 'markdown-frontmatter', loading: 'conditional' },
  { path: '**/CLAUDE.md', scope: 'project', format: 'markdown', loading: 'conditional' },
  { path: '**/CLAUDE.local.md', scope: 'project', format: 'markdown', loading: 'conditional' },
  { path: '**/AGENTS.md', scope: 'project', format: 'markdown', loading: 'conditional' },
];

function permissions(disableAutoMode: string): PermissionsKnowledge {
  return {
    files: SETTINGS_FILES,
    keys: [
      'permissions.allow',
      'permissions.ask',
      'permissions.deny',
      'permissions.additionalDirectories',
      'permissions.defaultMode',
      'permissions.disableBypassPermissionsMode',
      'permissions.blockReadsOutsideWorkingDirectories',
      'permissions.blockWritesOutsideWorkingDirectories',
      disableAutoMode,
    ],
    bypass: [
      { key: 'permissions.defaultMode', value: 'bypassPermissions' },
      { key: 'permissions.defaultMode', value: 'auto' },
      { key: 'permissions.defaultMode', value: 'acceptEdits' },
      { key: 'skipDangerousModePermissionPrompt', value: true },
      { key: 'enableAllProjectMcpServers', value: true },
    ],
  };
}

const PERMISSIONS_NOTE =
  'defaultMode bypassPermissions and auto do not take effect from .claude/settings.json or .claude/settings.local.json; before v2.1.257 bypassPermissions took effect from any file. skipDangerousModePermissionPrompt is read from user, local or managed settings only. A committed enableAllProjectMcpServers is ignored in an untrusted folder. permissions.allow and additionalDirectories in .claude/settings.json need workspace trust.';

export const claudeCode: AgentKnowledge = {
  id: 'claude-code',
  name: 'Claude Code',
  precedence: verified(
    [...MANAGED_SETTINGS, LOCAL_SETTINGS, PROJECT_SETTINGS, USER_SETTINGS],
    `${SETTINGS}#settings-precedence`,
    `Managed settings also arrive from MDM or the claude.ai console, and --settings ranks between managed and local; neither is a file in the repository. Files in managed-settings.d and managed-settings.json merge together (${MANAGED}). Lists such as permissions.allow merge across files instead of overriding, and a few restrictive keys are honored from lower levels.`,
  ),
  mcp: verified(
    {
      files: [
        { path: '.mcp.json', scope: 'project', format: 'json' },
        { path: '~/.claude.json', scope: 'user', format: 'json' },
        ...managed('managed-mcp.json', 'json'),
      ],
      serversKey: 'mcpServers',
      local: { command: 'command', args: 'args', env: 'env' },
      remote: { url: 'url', headers: 'headers' },
    },
    MCP,
    'The page shows no formal schema; field names come from its examples. A remote entry also needs type (http, or its alias streamable-http), because an entry with no type is read as a stdio server. Local-scope servers sit under projects.<path>.mcpServers in ~/.claude.json. The key inside managed-mcp.json was not checked. Interactive sessions ask before using .mcp.json servers; claude -p, SDK and some cloud sessions load them without asking. Subagent frontmatter can also declare servers (mcpServers).',
  ),
  hooks: verified(
    hooks,
    HOOKS,
    `Plugins add hooks in <plugin>/hooks/hooks.json. With args, command is an executable spawned without a shell; without args it runs through a shell. Hooks in settings files and a project skill's hooks run when only a parent folder is trusted and in claude -p; project subagent frontmatter hooks need trust of the exact folder (${PERMISSIONS}#what-runs-before-you-trust-a-folder). The page lists 33 events.`,
  ),
  skills: verified(
    {
      directories: [
        { path: '.claude/skills', scope: 'project', format: 'markdown-frontmatter' },
        { path: '~/.claude/skills', scope: 'user', format: 'markdown-frontmatter' },
        ...managed('.claude/skills', 'markdown-frontmatter'),
      ],
      entryFile: 'SKILL.md',
    },
    SKILLS,
    'Each skill is a folder <name>/SKILL.md below these directories. Plugins add <plugin>/skills/<name>/SKILL.md. Frontmatter can set hooks, allowed-tools and shell; workspace trust never gates allowed-tools.',
  ),
  contextFiles: verified(
    contextFiles,
    MEMORY,
    'AGENTS.md and .claude/AGENTS.md are read at session start, but by default only when no CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md exists in the working directory or above it (requires v2.1.277); they are marked conditional for that reason. Rules without paths frontmatter load at launch, rules with paths when matching files are used. Files in subdirectories load on demand; those in directories above the working directory load at launch and lie outside a project scan. @path imports pull other files into these. Only the first 200 lines or 25KB of auto memory load, and autoMemoryDirectory can move it.',
  ),
  permissions: disputed(
    `The docs disagree on where the switch that removes auto mode lives. ${PERMISSIONS_NOTE}`,
    evidence(permissions('permissions.disableAutoMode'), `${PERMISSIONS}#permission-modes`, 'Also used by every setup instruction on the permission-modes page; the value is "disable".'),
    evidence(permissions('disableAutoMode'), `${SETTINGS_REFERENCE}#settings-index`, 'The settings index lists a top-level disableAutoMode and no permissions.disableAutoMode.'),
  ),
  autoRun: verified(
    { files: [...SETTINGS_FILES, ...FRONTMATTER_HOOKS], triggerKey: 'hooks.SessionStart', triggerValue: 'any', commandField: 'command' },
    HOOKS,
    'Claude Code has no run-on-folder-open tasks. The closest fact is a SessionStart hook, which fires when a session begins or resumes, so the user must start Claude Code; any handler under the key counts, hence the triggerValue any. Only command and mcp_tool handlers are supported on this event. Setup fires only with --init-only, --init or --maintenance, not on normal startup.',
  ),
  extensions: verified(
    {
      subagents: [
        { path: '.claude/agents/*.md', scope: 'project', format: 'markdown-frontmatter' },
        { path: '~/.claude/agents/*.md', scope: 'user', format: 'markdown-frontmatter' },
        ...managed('.claude/agents/*.md', 'markdown-frontmatter'),
      ],
      commands: [
        { path: '.claude/commands/*.md', scope: 'project', format: 'markdown-frontmatter' },
        { path: '~/.claude/commands/*.md', scope: 'user', format: 'markdown-frontmatter' },
      ],
    },
    SUB_AGENTS,
    `Subagent frontmatter can set hooks, mcpServers and permissionMode, which are ignored for plugin subagents. Command paths are from ${DIRECTORY}: commands were merged into skills and share their frontmatter fields except name and paths; a skill wins over a command of the same name. That page also lists workflows/*.js, scripts that become commands, which this shape has no place for.`,
  ),
};
