import { verifiedOn } from './define.ts';
import type { AgentKnowledge, AgentPath } from './types.ts';

const { verified, uncertain } = verifiedOn('2026-11-06');

const RAW = 'https://raw.githubusercontent.com/google-gemini/gemini-cli/main';
const CONFIGURATION = `${RAW}/docs/reference/configuration.md`;
const MCP = `${RAW}/docs/tools/mcp-server.md`;
const HOOKS = `${RAW}/docs/hooks/reference.md`;
const SKILLS = `${RAW}/docs/cli/skills.md`;
const CONTEXT = `${RAW}/docs/cli/gemini-md.md`;
const SUBAGENTS = `${RAW}/docs/core/subagents.md`;
const COMMANDS = `${RAW}/docs/cli/custom-commands.md`;

const PROJECT_SETTINGS: AgentPath = { path: '.gemini/settings.json', scope: 'project', format: 'json' };
const USER_SETTINGS: AgentPath = { path: '~/.gemini/settings.json', scope: 'user', format: 'json' };
const SYSTEM_SETTINGS: readonly AgentPath[] = [
  { path: '/etc/gemini-cli/settings.json', scope: 'managed', format: 'json', platforms: ['linux'] },
  { path: '/Library/Application Support/GeminiCli/settings.json', scope: 'managed', format: 'json', platforms: ['darwin'] },
  { path: 'C:/ProgramData/gemini-cli/settings.json', scope: 'managed', format: 'json', platforms: ['win32'] },
];
const SYSTEM_DEFAULTS: readonly AgentPath[] = [
  { path: '/etc/gemini-cli/system-defaults.json', scope: 'managed', format: 'json', platforms: ['linux'] },
  { path: '/Library/Application Support/GeminiCli/system-defaults.json', scope: 'managed', format: 'json', platforms: ['darwin'] },
  { path: 'C:/ProgramData/gemini-cli/system-defaults.json', scope: 'managed', format: 'json', platforms: ['win32'] },
];
const SETTINGS_FILES: readonly AgentPath[] = [...SYSTEM_SETTINGS, PROJECT_SETTINGS, USER_SETTINGS, ...SYSTEM_DEFAULTS];

export const geminiCli: AgentKnowledge = {
  id: 'gemini-cli',
  name: 'Gemini CLI',
  precedence: verified(
    SETTINGS_FILES,
    `${RAW}/packages/cli/src/config/settings.ts`,
    'Single values: the system override wins over project, then user, then system defaults; environment variables and command-line arguments win over all files. Paths of managed files are absolute, unlike the type describes. GEMINI_CLI_SYSTEM_SETTINGS_PATH and GEMINI_CLI_SYSTEM_DEFAULTS_PATH move the system files, GEMINI_CLI_HOME moves the user directory. In an untrusted folder the project file is not applied.',
  ),
  mcp: verified(
    {
      files: SETTINGS_FILES,
      serversKey: 'mcpServers',
      local: { command: 'command', args: 'args', env: 'env' },
      remote: { url: 'url', headers: 'headers', otherUrls: ['httpUrl'] },
    },
    MCP,
    'A remote server may use httpUrl (streamable HTTP) in place of url (SSE), so scanners must read both. In packages/core/src/tools/mcp-client.ts (createUrlTransport, main at 3fd7d26) httpUrl is deprecated and wins when both are set, and url with no type tries streamable HTTP, then SSE. settingsSchema.ts also has type (stdio, sse, http) and tcp (websocket), which this page does not document. Other fields that matter: cwd, trust (true skips all tool confirmations), includeTools, excludeTools; the global mcp.serverCommand can also start a server, and mcp.allowed and mcp.excluded filter servers. Extensions can also contribute configuration.',
  ),
  hooks: verified(
    {
      files: SETTINGS_FILES,
      key: 'hooks',
      events: ['BeforeTool', 'AfterTool', 'BeforeAgent', 'AfterAgent', 'BeforeModel', 'BeforeToolSelection', 'AfterModel', 'SessionStart', 'SessionEnd', 'Notification', 'PreCompress'],
      handlerTypes: ['command'],
      commandField: 'command',
    },
    HOOKS,
    'Shape: hooks.<event>[].hooks[].command. Extensions can define hooks too. Run order differs from settings precedence: hookRegistry.ts sorts runtime, project, user, system, extensions. hooksConfig.enabled and hooksConfig.disabled turn hooks off.',
  ),
  skills: verified(
    {
      directories: [
        { path: '.agents/skills', scope: 'project', format: 'markdown-frontmatter' },
        { path: '.gemini/skills', scope: 'project', format: 'markdown-frontmatter' },
        { path: '~/.agents/skills', scope: 'user', format: 'markdown-frontmatter' },
        { path: '~/.gemini/skills', scope: 'user', format: 'markdown-frontmatter' },
      ],
      entryFile: 'SKILL.md',
    },
    SKILLS,
    'Listed from the one that wins. Built-in and extension skills have lower precedence and no documented directory. skillManager.ts does not load the project directories in an untrusted folder.',
  ),
  contextFiles: verified(
    [
      { path: '~/.gemini/GEMINI.md', scope: 'user', format: 'markdown', loading: 'always' },
      { path: 'GEMINI.md', scope: 'project', format: 'markdown', loading: 'always' },
      { path: '**/GEMINI.md', scope: 'project', format: 'markdown', loading: 'conditional' },
    ],
    CONTEXT,
    'The name is only the default: context.fileName (a string or a list, e.g. AGENTS.md) replaces it in every location, so a scanner must read that setting. Parent directories of the workspace are searched too, bounded by context.memoryBoundaryMarkers (default .git). A file can import others with @file.md, relative or absolute. How several names in the list interact is not documented.',
  ),
  permissions: verified(
    {
      files: [
        ...SETTINGS_FILES,
        { path: '~/.gemini/policies/*.toml', scope: 'user', format: 'toml' },
        { path: '/etc/gemini-cli/policies', scope: 'managed', format: 'toml', platforms: ['linux'] },
        { path: '/Library/Application Support/GeminiCli/policies', scope: 'managed', format: 'toml', platforms: ['darwin'] },
        { path: 'C:/ProgramData/gemini-cli/policies', scope: 'managed', format: 'toml', platforms: ['win32'] },
      ],
      keys: ['general.defaultApprovalMode', 'tools.allowed', 'tools.confirmationRequired', 'tools.core', 'tools.exclude', 'mcp.allowed', 'mcp.excluded', 'mcpServers.*.trust', 'policyPaths', 'adminPolicyPaths', 'security.disableYoloMode', 'security.disableAlwaysAllow', 'security.enablePermanentToolApproval', 'security.folderTrust.enabled', 'admin.secureModeEnabled', 'rule'],
      bypass: [
        { key: 'mcpServers.*.trust', value: true },
        { key: 'general.defaultApprovalMode', value: 'auto_edit' },
      ],
      allowAllShell: [{ key: 'tools.allowed', value: 'run_shell_command' }],
    },
    CONFIGURATION,
    'YOLO cannot be set in a file: only --yolo or --approval-mode=yolo enable it. auto_edit approves edit tools only, and tools.allowed skips prompts per tool. Policy rules are [[rule]] tables, read through the key rule with toolName, decision, priority, commandPrefix, commandRegex and modes (docs/reference/policy-engine.md). .gemini/policies in a workspace has no effect, per the same page, so it is left out. tools.exclude is deprecated in favor of deny rules. allowAllShell is inferred: docs/tools/shell.md says a bare run_shell_command in tools.core is a wildcard for any command not blocked, and this page says tools.core mirrors the matching of tools.allowed, which skips the confirmation.',
  ),
  autoRun: uncertain(
    { files: SETTINGS_FILES, triggerKey: 'hooks.SessionStart', triggerValue: 'startup', commandField: 'command' },
    HOOKS,
    'No documented file runs a command when a folder is opened. The closest is a SessionStart hook, which fires on startup, resume and /clear. hookRegistry.ts loads project hooks only in a trusted folder, and then warns once and marks them trusted, with no approval step. Which matcher strings SessionStart accepts is not documented, so startup as a value is the source field, not a confirmed matcher.',
  ),
  extensions: verified(
    {
      subagents: [
        { path: '.gemini/agents/*.md', scope: 'project', format: 'markdown-frontmatter' },
        { path: '~/.gemini/agents/*.md', scope: 'user', format: 'markdown-frontmatter' },
      ],
      commands: [
        { path: '.gemini/commands', scope: 'project', format: 'toml' },
        { path: '~/.gemini/commands', scope: 'user', format: 'toml' },
      ],
    },
    SUBAGENTS,
    `Commands come from ${COMMANDS}: *.toml files, a project command wins over a user one, and a prompt can run shell commands with !{...} after a confirmation. registry.ts skips project agents in an untrusted folder and registers them only after acknowledgement. experimental.enableAgents turns subagents off.`,
  ),
};
