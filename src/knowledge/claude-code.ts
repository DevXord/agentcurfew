import { verifiedOn } from './define.ts';
import type { AgentKnowledge, AgentPath, ContextFile, FileFormat, HooksKnowledge, PermissionsKnowledge } from './types.ts';

const { verified } = verifiedOn('2026-11-06');
// Facts changed after the source audit of 2026-11-07, read again that day.
const later = verifiedOn('2026-11-07');

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
  { path: '**/.claude/skills/*/SKILL.md', scope: 'project', format: 'markdown-frontmatter' },
  { path: '~/.claude/skills/*/SKILL.md', scope: 'user', format: 'markdown-frontmatter' },
  { path: '**/.claude/agents/**/*.md', scope: 'project', format: 'markdown-frontmatter' },
  { path: '~/.claude/agents/**/*.md', scope: 'user', format: 'markdown-frontmatter' },
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
  { path: '**/.claude/rules/**/*.md', scope: 'project', format: 'markdown-frontmatter', loading: 'conditional' },
  { path: '.claude/output-styles/*.md', scope: 'project', format: 'markdown-frontmatter', loading: 'conditional' },
  { path: '~/.claude/output-styles/*.md', scope: 'user', format: 'markdown-frontmatter', loading: 'conditional' },
  { path: '~/.claude/rules/**/*.md', scope: 'user', format: 'markdown-frontmatter', loading: 'conditional' },
  { path: '**/CLAUDE.md', scope: 'project', format: 'markdown', loading: 'conditional' },
  { path: '**/CLAUDE.local.md', scope: 'project', format: 'markdown', loading: 'conditional' },
  { path: '**/AGENTS.md', scope: 'project', format: 'markdown', loading: 'conditional' },
];

function permissions(): PermissionsKnowledge {
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
      'permissions.disableAutoMode',
      'disableAutoMode',
    ],
    bypass: [
      { key: 'permissions.defaultMode', value: 'bypassPermissions', fromProject: 'ignored' },
      { key: 'permissions.defaultMode', value: 'auto', fromProject: 'ignored' },
      { key: 'permissions.defaultMode', value: 'acceptEdits', approves: 'file edits and common file system commands in the working directories' },
      { key: 'skipDangerousModePermissionPrompt', value: true, fromProject: 'ignored' },
      { key: 'enableAllProjectMcpServers', value: true, fromProject: 'needs-trust' },
      { key: 'enabledMcpjsonServers', value: '*', fromProject: 'needs-trust' },
    ],
    allowAllShell: [
      { key: 'permissions.allow', value: 'Bash' },
      { key: 'permissions.allow', value: 'Bash(*)' },
    ],
  };
}

const PERMISSIONS_NOTE =
  'defaultMode acceptEdits "Automatically accepts file edits and common filesystem commands such as mkdir, touch, mv, and cp" in the working directories (permissions page, read on 2026-11-07). defaultMode bypassPermissions and auto do not take effect from .claude/settings.json or .claude/settings.local.json; before v2.1.257 bypassPermissions took effect from any file. skipDangerousModePermissionPrompt is read from user, local or managed settings only. A committed enableAllProjectMcpServers, or enabledMcpjsonServers, which approves the servers it names, is ignored in an untrusted folder: Claude Code "ignores it in the shared project file". permissions.allow and additionalDirectories in .claude/settings.json need workspace trust. A bare Bash, or Bash(*), in permissions.allow matches every Bash command (https://code.claude.com/docs/en/permissions#match-all-uses-of-a-tool).';

export const claudeCode: AgentKnowledge = {
  id: 'claude-code',
  name: 'Claude Code',
  precedence: verified(
    [...MANAGED_SETTINGS, LOCAL_SETTINGS, PROJECT_SETTINGS, USER_SETTINGS],
    `${SETTINGS}#settings-precedence`,
    `Managed settings also arrive from MDM or the claude.ai console, and --settings ranks between managed and local; neither is a file in the repository. Files in managed-settings.d and managed-settings.json merge together (${MANAGED}). Lists such as permissions.allow merge across files instead of overriding, and a few restrictive keys are honored from lower levels.`,
  ),
  mcp: later.verified(
    {
      files: [
        { path: '.mcp.json', scope: 'project', format: 'json' },
        { path: '~/.claude.json', scope: 'user', format: 'json' },
        { path: '~/.claude.json', scope: 'user', format: 'json', serversKey: 'projects.<project>.mcpServers' },
        ...managed('managed-mcp.json', 'json'),
        ...MANAGED_SETTINGS.map((file) => ({ ...file, serversKey: 'managedMcpServers' })),
      ],
      serversKey: 'mcpServers',
      local: { command: 'command', args: 'args', env: 'env' },
      remote: { url: 'url', headers: 'headers' },
    },
    MCP,
    'The page shows no formal schema; field names come from its examples. A remote entry also needs type (http, its alias streamable-http, sse or ws), because an entry with no type is read as a stdio server. A remote entry may set headersHelper, a command Claude Code runs when connecting to print headers; agentcurfew does not check that command yet. Managed settings can add remote servers under managedMcpServers (v2.1.259). Local-scope servers sit under projects.<path>.mcpServers in ~/.claude.json. The key inside managed-mcp.json was not checked. Interactive sessions ask before using .mcp.json servers; claude -p, SDK and some cloud sessions load them without asking. Subagent frontmatter can also declare servers (mcpServers).',
  ),
  hooks: later.verified(
    hooks,
    HOOKS,
    `Plugins add hooks in <plugin>/hooks/hooks.json. With args, command is an executable spawned without a shell; without args it runs through a shell. Hooks in settings files and a project skill's hooks run when only a parent folder is trusted and in claude -p; project subagent frontmatter hooks need trust of the exact folder (${PERMISSIONS}#what-runs-before-you-trust-a-folder). The page lists 33 events.`,
  ),
  skills: later.verified(
    {
      directories: [
        { path: '**/.claude/skills', scope: 'project', format: 'markdown-frontmatter' },
        { path: '~/.claude/skills', scope: 'user', format: 'markdown-frontmatter' },
        ...managed('.claude/skills', 'markdown-frontmatter'),
      ],
      entryFile: 'SKILL.md',
      grantsField: 'allowed-tools',
    },
    SKILLS,
    'Each skill is a folder <name>/SKILL.md below these directories; a nested <subdir>/.claude/skills loads for sessions in or below <subdir>. Plugins add <plugin>/skills/<name>/SKILL.md, and a skill folder with .claude-plugin/plugin.json loads as a plugin with its own agents, hooks and MCP servers. Frontmatter can set hooks, allowed-tools and shell; workspace trust never gates allowed-tools. allowed-tools takes a space- or comma-separated string or a YAML list, and grants those tools without a prompt during the turn that invokes the skill; it does not restrict the other tools.',
  ),
  contextFiles: later.verified(
    contextFiles,
    MEMORY,
    'AGENTS.md and .claude/AGENTS.md are read at session start, but by default only when no CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md exists in the working directory or above it (requires v2.1.277); they are marked conditional for that reason. Rules without paths frontmatter load at launch, rules with paths when matching files are used. Files in subdirectories, nested .claude/rules folders included, load on demand; output styles (.claude/output-styles/*.md, ${DIRECTORY}) are instructions that adjust how Claude works, used when chosen; those in directories above the working directory load at launch and lie outside a project scan. @path imports pull other files into these. Only the first 200 lines or 25KB of auto memory load, and autoMemoryDirectory can move it.',
  ),
  permissions: later.verified(
    permissions(),
    `${SETTINGS_REFERENCE}#settings-index`,
    `${PERMISSIONS_NOTE} The switch that removes auto mode is a top-level disableAutoMode, "Also accepted under permissions as permissions.disableAutoMode" (${SETTINGS_REFERENCE}), which settles the earlier dispute with ${PERMISSIONS}#permission-modes.`,
  ),
  autoRun: later.verified(
    { files: SETTINGS_FILES, triggerKey: 'hooks.SessionStart', triggerValue: 'any', commandField: 'command' },
    HOOKS,
    'Claude Code has no run-on-folder-open tasks. The closest fact is a SessionStart hook, which fires when a session begins or resumes, so the user must start Claude Code; any handler under the key counts, hence the triggerValue any. Only command and mcp_tool handlers are supported on this event. Setup fires only with --init-only, --init or --maintenance, not on normal startup. Hooks in skill and subagent frontmatter are left out: "Claude Code runs them only while that subagent is running" (read on 2026-11-07), so they do not start on their own.',
  ),
  extensions: later.verified(
    {
      subagents: [
        { path: '**/.claude/agents/**/*.md', scope: 'project', format: 'markdown-frontmatter' },
        { path: '~/.claude/agents/**/*.md', scope: 'user', format: 'markdown-frontmatter' },
        ...managed('.claude/agents/**/*.md', 'markdown-frontmatter'),
      ],
      commands: [
        { path: '.claude/commands/**/*.md', scope: 'project', format: 'markdown-frontmatter' },
        { path: '~/.claude/commands/**/*.md', scope: 'user', format: 'markdown-frontmatter' },
      ],
    },
    SUB_AGENTS,
    `.claude/agents/ is scanned recursively, in every folder from the working directory up to the repository root. Subagent frontmatter can set hooks, mcpServers and permissionMode, which are ignored for plugin subagents. Command paths are from ${DIRECTORY}; subfolders of .claude/commands namespace a command (.claude/commands/frontend/component.md is /frontend:component, ${SKILLS}, read on 2026-11-07); commands were merged into skills and share their frontmatter fields except name and paths; a skill wins over a command of the same name. That page also lists workflows/*.js, scripts that become commands, which this shape has no place for.`,
  ),
  toolHook: verified(
    {
      event: 'PreToolUse',
      settingsKey: 'hooks.PreToolUse',
      toolNameField: 'tool_name',
      toolInputField: 'tool_input',
      tools: {
        Bash: { command: 'command' },
        Write: { path: 'file_path', content: 'content' },
        Edit: { path: 'file_path', oldText: 'old_string', newText: 'new_string', replaceAll: 'replace_all' },
      },
      decisionField: 'hookSpecificOutput.permissionDecision',
      eventNameField: 'hookSpecificOutput.hookEventName',
      reasonField: 'hookSpecificOutput.permissionDecisionReason',
      decisions: ['deny', 'defer', 'ask', 'allow'],
      projectDirVariable: 'CLAUDE_PROJECT_DIR',
    },
    HOOKS,
    `The stdin JSON also has session_id, transcript_path, cwd, permission_mode, hook_event_name and tool_use_id. "When multiple PreToolUse hooks return different decisions, precedence is deny > defer > ask > allow", and matching hooks run in parallel, so another hook on the same tool (depcurfew's) keeps working. defer needs non-interactive mode (-p). Exit code 2 blocks whatever the JSON says. hookSpecificOutput "requires a hookEventName field set to the event name"; stdout must hold nothing but the JSON object; "Exit code 0 with no output means the hook has no decision to report", and staying silent does not approve the call. Command hooks time out after 600 s by default. A matcher of letters, digits, _, -, spaces, commas and | lists exact tool names. There is no MultiEdit tool (${DOCS}/tools-reference); the input fields of NotebookEdit are not shown in the docs, so it is left out.`,
  ),
  mcpAdd: verified(
    { command: ['claude', 'mcp', 'add'], jsonCommand: ['claude', 'mcp', 'add-json'], separator: '--', valueOptions: ['--transport', '-t', '--env', '-e', '--scope', '-s', '--header', '-H'] },
    MCP,
    'Syntax: claude mcp add [options] <name> -- <command> [args...]; with --transport http or sse the argument after the name is the address. --scope project writes .mcp.json.',
  ),
};
