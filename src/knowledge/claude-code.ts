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

const today = verifiedOn('2026-11-08');
// Facts of phase 13, read on 2026-11-09.
const phase13 = verifiedOn('2026-11-09');

const ENV_NOTE =
  'env is documented with Scope "Any file". From user, --settings and managed settings it applies at startup; from project and local settings "after you trust the workspace, or at startup in -p mode, which never shows the trust dialog" (#when-claude-code-applies-env-values), and the table of what runs before a folder is trusted lists the env block as "Used" when only a parent folder is trusted and in claude -p (https://code.claude.com/docs/en/permissions#what-runs-before-you-trust-a-folder). Variables that redirect requests, from the environment variables reference (https://code.claude.com/docs/en/env-vars): ANTHROPIC_BASE_URL "Override the API endpoint to route requests through a proxy or gateway", the Bedrock, Bedrock Mantle, Agent Platform (Vertex), Foundry and Claude Platform on AWS endpoint URLs, HTTP_PROXY and HTTPS_PROXY, and ANTHROPIC_CUSTOM_HEADERS, "Custom headers to add to requests". CLAUDE_CODE_SHELL_PREFIX is a "Command prefix that wraps shell commands Claude Code spawns: Bash tool calls, hook commands, status line commands, and stdio MCP server startup commands". Project and local settings cannot set the OpenTelemetry exporter variables whose names end in _ENDPOINT or _HEADERS (from v2.1.282), BETA_TRACING_ENDPOINT, CLAUDE_CODE_PROCESS_WRAPPER, CLAUDE_CONFIG_DIR and others listed under #variables-claude-code-ignores-in-env.';

const PLUGINS_NOTE =
  'enabledPlugins maps plugin-name@marketplace-name to a Boolean, Scope "Any file"; project settings take precedence over user settings. A plugin with an external source that only the project\'s .claude/settings.json enables is not fetched onto a machine where it is not installed, unless its marketplace entry has a relative-path source, which loads from the marketplace itself (https://code.claude.com/docs/en/plugins/loading#enabled-in-project-settings-but-not-installed). extraKnownMarketplaces (alias additionalMarketplaces) maps a name to { source, autoUpdate }; entries in a repository\'s .claude/settings.json or .claude/settings.local.json are honored "only after you accept the workspace trust dialog for that folder", and ignored without a message otherwise, also in -p. Source types: github (repo, ref, path, sparsePaths), git (url, ref, path, sparsePaths), url (a marketplace.json address, with headers and headersHelper), file and directory (local paths), and settings (plugins declared inline, which must reference external sources); a marketplace source has no sha (https://code.claude.com/docs/en/plugins/marketplace-reference). autoUpdate true refreshes the marketplace and updates its installed plugins in the background after startup; it defaults to false for third-party marketplaces. headersHelper of a url source is a command run before each fetch of marketplace.json and each plugin download from its origin, only for https:// addresses; from a project settings file only after the trust dialog for that folder (https://code.claude.com/docs/en/plugins/host-marketplace#when-a-marketplace-url-sources-command-runs). Plugin packages themselves (.claude-plugin/plugin.json, plugins under .claude/skills) are not covered by this fact.';

const COMMANDS_NOTE =
  'Each key is documented with Scope "Any file", so a committed .claude/settings.json can set it. statusLine is an object with type "command" and a command string; the status line script "runs once when a session starts, including when you resume one", then on events and every refreshInterval seconds (https://code.claude.com/docs/en/statusline). otelHeadersHelper runs "at startup and periodically after that". apiKeyHelper reruns after its cache lifetime or on 401 and 403; awsAuthRefresh and gcpAuthRefresh run when credentials fail; awsCredentialExport whenever Bedrock credentials are needed; fileSuggestion on @ autocomplete; subagentStatusLine on each refresh of the subagent rows. statusLine, fileSuggestion and subagentStatusLine follow "the same workspace trust rule as hooks in settings files", and are narrowed to managed values by allowManagedHooksOnly or a non-managed disableAllHooks. Helper commands such as apiKeyHelper are "Used" when only a parent folder is trusted and in claude -p, like hooks (https://code.claude.com/docs/en/permissions#what-runs-before-you-trust-a-folder). sshHostCommands, processWrapper and policyHelper are user or managed only, so a repository cannot set them, and are left out.';

export const claudeCode: AgentKnowledge = {
  id: 'claude-code',
  name: 'Claude Code',
  precedence: verified(
    [...MANAGED_SETTINGS, LOCAL_SETTINGS, PROJECT_SETTINGS, USER_SETTINGS],
    `${SETTINGS}#settings-precedence`,
    `Managed settings also arrive from MDM or the claude.ai console, and --settings ranks between managed and local; neither is a file in the repository. Files in managed-settings.d and managed-settings.json merge together (${MANAGED}). Lists such as permissions.allow merge across files instead of overriding, and a few restrictive keys are honored from lower levels.`,
  ),
  mcp: phase13.verified(
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
      remote: { url: 'url', headers: 'headers', headersHelper: 'headersHelper' },
    },
    MCP,
    'The page shows no formal schema; field names come from its examples. A remote entry also needs type (http, its alias streamable-http, sse or ws), because an entry with no type is read as a stdio server. headersHelper of an http, sse or ws server is a command: Claude Code "executes a headersHelper as an arbitrary shell command" when connecting and merges the JSON it prints into the headers (#use-dynamic-headers-for-custom-authentication). For a server in .mcp.json or at local scope it runs only after the trust dialog for that project folder is accepted; trust of a parent folder and claude -p do not count, and the server is then connected with its static headers alone (#trust-a-folder-before-its-headershelper-runs; before v2.1.238 claude -p ran it without trust). Read again on 2026-11-09. Managed settings can add remote servers under managedMcpServers (v2.1.259). Local-scope servers sit under projects.<path>.mcpServers in ~/.claude.json. The key inside managed-mcp.json was not checked. Interactive sessions ask before using .mcp.json servers; claude -p, SDK and some cloud sessions load them without asking. Subagent frontmatter can also declare servers (mcpServers).',
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
  commands: today.verified(
    {
      files: SETTINGS_FILES,
      settings: [
        { key: 'statusLine', commandField: 'command', runs: 'session-start' },
        { key: 'subagentStatusLine', commandField: 'command', runs: 'on-demand' },
        { key: 'fileSuggestion', commandField: 'command', runs: 'on-demand' },
        { key: 'apiKeyHelper', runs: 'on-demand' },
        { key: 'otelHeadersHelper', runs: 'session-start' },
        { key: 'awsAuthRefresh', runs: 'on-demand' },
        { key: 'awsCredentialExport', runs: 'on-demand' },
        { key: 'gcpAuthRefresh', runs: 'on-demand' },
      ],
    },
    `${SETTINGS_REFERENCE}#settings-index`,
    COMMANDS_NOTE,
  ),
  env: phase13.verified(
    {
      files: SETTINGS_FILES,
      key: 'env',
      variables: [
        { name: 'ANTHROPIC_BASE_URL', effect: 'endpoint' },
        { name: 'ANTHROPIC_BEDROCK_BASE_URL', effect: 'endpoint' },
        { name: 'ANTHROPIC_BEDROCK_MANTLE_BASE_URL', effect: 'endpoint' },
        { name: 'ANTHROPIC_VERTEX_BASE_URL', effect: 'endpoint' },
        { name: 'ANTHROPIC_FOUNDRY_BASE_URL', effect: 'endpoint' },
        { name: 'ANTHROPIC_AWS_BASE_URL', effect: 'endpoint' },
        { name: 'HTTP_PROXY', effect: 'proxy' },
        { name: 'HTTPS_PROXY', effect: 'proxy' },
        { name: 'ANTHROPIC_CUSTOM_HEADERS', effect: 'headers' },
        { name: 'CLAUDE_CODE_SHELL_PREFIX', effect: 'command-wrapper' },
        { name: 'OTEL_EXPORTER_OTLP_ENDPOINT', effect: 'endpoint', fromProject: 'ignored' },
        { name: 'OTEL_EXPORTER_OTLP_HEADERS', effect: 'headers', fromProject: 'ignored' },
        { name: 'BETA_TRACING_ENDPOINT', effect: 'endpoint', fromProject: 'ignored' },
      ],
    },
    `${SETTINGS_REFERENCE}#env`,
    ENV_NOTE,
  ),
  hooksOff: phase13.verified(
    { files: SETTINGS_FILES, key: 'disableAllHooks' },
    `${SETTINGS_REFERENCE}#disableallhooks`,
    'Scope "Any file". true turns off hooks, any custom status line and any custom file suggestion command. Outside managed settings it "disables user, project, local, and plugin hooks"; managed hooks, Agent SDK hooks and hooks of plugins force-enabled in managed settings keep running, and only managed settings can disable managed hooks. Claude Code reads the value left after settings precedence, so a project file can set it either way (https://code.claude.com/docs/en/hooks#disable-or-remove-hooks). Read on 2026-11-09.',
  ),
  plugins: phase13.verified(
    {
      files: SETTINGS_FILES,
      enabledKey: 'enabledPlugins',
      marketplacesKeys: ['extraKnownMarketplaces', 'additionalMarketplaces'],
      marketplacesFromProject: 'needs-trust',
      sources: [
        { type: 'github', where: 'remote' },
        { type: 'git', where: 'remote', urlField: 'url' },
        { type: 'url', where: 'remote', urlField: 'url', headersHelper: 'headersHelper' },
        { type: 'file', where: 'local' },
        { type: 'directory', where: 'local' },
        { type: 'settings', where: 'inline' },
      ],
      autoUpdateField: 'autoUpdate',
    },
    `${SETTINGS_REFERENCE}#extraknownmarketplaces`,
    PLUGINS_NOTE,
  ),
  mcpAdd: verified(
    { command: ['claude', 'mcp', 'add'], jsonCommand: ['claude', 'mcp', 'add-json'], separator: '--', valueOptions: ['--transport', '-t', '--env', '-e', '--scope', '-s', '--header', '-H'] },
    MCP,
    'Syntax: claude mcp add [options] <name> -- <command> [args...]; with --transport http or sse the argument after the name is the address. --scope project writes .mcp.json.',
  ),
};
