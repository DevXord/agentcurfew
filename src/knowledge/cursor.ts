import { verifiedOn } from './define.ts';
import type { AgentKnowledge, AgentPath, ContextFile, FileFormat } from './types.ts';

const { verified, uncertain } = verifiedOn('2026-11-06');

const MCP = 'https://cursor.com/docs/context/mcp';
const HOOKS = 'https://cursor.com/docs/hooks';
const THIRD_PARTY_HOOKS = 'https://cursor.com/docs/reference/third-party-hooks';
const SKILLS = 'https://cursor.com/docs/skills';
const RULES = 'https://cursor.com/docs/rules';
const RULES_HELP = 'https://cursor.com/help/customization/rules';
const PERMISSIONS = 'https://cursor.com/docs/reference/permissions';
const CLI_PERMISSIONS = 'https://cursor.com/docs/cli/reference/permissions';
const CLI_CONFIG = 'https://cursor.com/docs/cli/reference/configuration';
const SANDBOX = 'https://cursor.com/docs/reference/sandbox';
const RUN_MODES = 'https://cursor.com/docs/agent/security/run-modes';
const SUBAGENTS = 'https://cursor.com/docs/subagents';
const COMMANDS_CHANGELOG = 'https://cursor.com/changelog/1-6';
const AGENT_SECURITY = 'https://cursor.com/docs/agent/security';
const WORKSPACE_TRUST = 'https://cursor.com/docs/enterprise/identity-and-access-management';
const VSCODE_TASKS = 'https://code.visualstudio.com/docs/debugtest/tasks';
const OASIS_REPORT = 'https://www.oasis.security/blog/cursor-security-flaw';

const project = (path: string, format: FileFormat): AgentPath => ({ path, scope: 'project', format });
const user = (path: string, format: FileFormat): AgentPath => ({ path, scope: 'user', format });

const HOOK_FILES: readonly AgentPath[] = [
  { path: '/Library/Application Support/Cursor/hooks.json', scope: 'managed', format: 'json', platforms: ['darwin'] },
  { path: '/etc/cursor/hooks.json', scope: 'managed', format: 'json', platforms: ['linux'] },
  { path: 'C:/ProgramData/Cursor/hooks.json', scope: 'managed', format: 'json', platforms: ['win32'] },
  project('.cursor/hooks.json', 'json'),
  user('~/.cursor/hooks.json', 'json'),
  project('.claude/settings.local.json', 'json'),
  project('.claude/settings.json', 'json'),
  user('~/.claude/settings.json', 'json'),
];

const CONTEXT_FILES: readonly ContextFile[] = [
  { ...project('.cursor/rules/**/*.mdc', 'markdown-frontmatter'), loading: 'conditional' },
  { ...project('AGENTS.md', 'markdown'), loading: 'always' },
  { ...project('**/AGENTS.md', 'markdown'), loading: 'conditional' },
  { ...project('CLAUDE.md', 'markdown'), loading: 'always' },
  { ...project('.cursorrules', 'text'), loading: 'always' },
];

export const cursor: AgentKnowledge = {
  id: 'cursor',
  name: 'Cursor',
  precedence: uncertain(
    HOOK_FILES,
    THIRD_PARTY_HOOKS,
    `Cursor documents no single configuration order, only one per feature; this is the order for hooks, the only one that names files at every scope (team hooks sit between managed and project but live in the dashboard). Sandbox: per-user < per-repo < team-admin < hardcoded (${SANDBOX}). Permissions: team dashboard, then permissions.json, then IDE settings (${PERMISSIONS}). Rules: Team, Project, User (${RULES}). The CLI configuration page does not rank its files (${CLI_CONFIG}), and the MCP page does not say which file wins for a server defined in both (${MCP}).`,
  ),
  mcp: verified(
    {
      files: [project('.cursor/mcp.json', 'json'), user('~/.cursor/mcp.json', 'json')],
      serversKey: 'mcpServers',
      local: { command: 'command', args: 'args', env: 'env' },
      remote: { url: 'url', headers: 'headers' },
    },
    MCP,
    'Also documented: type (stdio), envFile (stdio only; a path to a file of variables) and auth (static OAuth: CLIENT_ID, CLIENT_SECRET, scopes). Interpolation applies to command, args, env, url and headers, so a literal value is not always the effective one. The page does not say which file wins for a server defined in both.',
  ),
  hooks: verified(
    {
      files: HOOK_FILES,
      key: 'hooks',
      events: [
        'sessionStart',
        'sessionEnd',
        'preToolUse',
        'postToolUse',
        'postToolUseFailure',
        'subagentStart',
        'subagentStop',
        'beforeShellExecution',
        'afterShellExecution',
        'beforeMCPExecution',
        'afterMCPExecution',
        'beforeReadFile',
        'afterFileEdit',
        'beforeSubmitPrompt',
        'preCompact',
        'stop',
        'afterAgentResponse',
        'afterAgentThought',
        'beforeTabFileRead',
        'afterTabFileEdit',
        'workspaceOpen',
      ],
      handlerTypes: ['command', 'prompt'],
      commandField: 'command',
    },
    HOOKS,
    `Files are in priority order (${THIRD_PARTY_HOOKS}). The .claude files use Claude Code event names and load only while Include Third-Party Plugins, Skills, and Other Configs is on, which is the default. workspaceOpen fires when Cursor opens a workspace, so a hook on it starts with no prompt to the agent. Project hooks need a trusted workspace, but workspace trust is off by default (${AGENT_SECURITY}) and off means all workspaces are automatically trusted (${WORKSPACE_TRUST}); reading these together, a committed .cursor/hooks.json runs without a trust prompt by default. That conclusion is an inference and was not tested.`,
  ),
  skills: verified(
    {
      directories: [
        project('**/.agents/skills', 'markdown-frontmatter'),
        project('**/.cursor/skills', 'markdown-frontmatter'),
        project('.claude/skills', 'markdown-frontmatter'),
        project('.codex/skills', 'markdown-frontmatter'),
        user('~/.agents/skills', 'markdown-frontmatter'),
        user('~/.cursor/skills', 'markdown-frontmatter'),
        user('~/.claude/skills', 'markdown-frontmatter'),
        user('~/.codex/skills', 'markdown-frontmatter'),
      ],
      entryFile: 'SKILL.md',
    },
    SKILLS,
    'The ** covers the project root too: a .cursor/skills or .agents/skills folder anywhere in a repository is picked up and applies to files inside that folder. Skills may bundle scripts/, references/ and assets/. name must match the parent folder.',
  ),
  contextFiles: verified(
    CONTEXT_FILES,
    RULES_HELP,
    `Paths in .cursor/rules, the root AGENTS.md, CLAUDE.md and the legacy .cursorrules are from this page. CLAUDE.md is always applied, regardless of alwaysApply. Nested AGENTS.md files and the ignoring of a plain .md in .cursor/rules ("Project rules must use the .mdc extension") are from ${RULES}. An .mdc rule is always loaded with alwaysApply: true, and otherwise by glob, by its description or by @-mention. .cursorrules "is legacy and will be deprecated"; its removal was not announced in what was read, and the always value comes from the migration advice to set it to Always Apply. User rules live in the app and team rules in the dashboard, so neither is a file.`,
  ),
  permissions: verified(
    {
      files: [
        project('.cursor/permissions.json', 'json'),
        user('~/.cursor/permissions.json', 'json'),
        project('.cursor/cli.json', 'json'),
        user('~/.cursor/cli-config.json', 'json'),
        project('.cursor/sandbox.json', 'json'),
        user('~/.cursor/sandbox.json', 'json'),
      ],
      keys: [
        'mcpAllowlist',
        'terminalAllowlist',
        'autoRun.allow_instructions',
        'autoRun.block_instructions',
        'permissions.allow',
        'permissions.deny',
        'approvalMode',
        'type',
        'readBoundary',
        'additionalReadPaths',
        'additionalReadwritePaths',
        'additionalReadonlyPaths',
        'networkPolicy.default',
        'networkPolicy.allow',
        'networkPolicy.deny',
      ],
      bypass: [
        { key: 'mcpAllowlist', value: '*:*' },
        { key: 'type', value: 'insecure_none' },
        { key: 'networkPolicy.default', value: 'allow' },
      ],
    },
    PERMISSIONS,
    `Keys by file: permissions.json has mcpAllowlist, terminalAllowlist and autoRun; cli.json and cli-config.json have permissions.allow and permissions.deny (${CLI_PERMISSIONS}), where deny wins; only cli-config.json has approvalMode (allowlist, auto-review, unrestricted), since a project may set only permissions (${CLI_CONFIG}); sandbox.json has the rest (${SANDBOX}). The bypass entries mean: mcpAllowlist containing *:* covers every MCP tool of every server; type insecure_none in sandbox.json turns the sandbox off; networkPolicy.default allow permits all traffic. approvalMode unrestricted is left out because the page does not say it skips prompts, though it can only be set outside the repository anyway. The run mode itself is chosen in the app or the team dashboard, and no file is documented to select it (${RUN_MODES}). permissions.json works only while Run Mode is on, is ignored when a team configuration exists, and its autoRun lists are guidance for a classifier, not enforcement. CURSOR_CONFIG_DIR and XDG_CONFIG_HOME move cli-config.json.`,
  ),
  autoRun: uncertain(
    {
      files: [project('.vscode/tasks.json', 'jsonc')],
      triggerKey: 'runOptions.runOn',
      triggerValue: 'folderOpen',
      commandField: 'command',
    },
    AGENT_SECURITY,
    `Cursor's own documentation never mentions tasks.json or folderOpen. This page says only that workspace trust "is disabled by default". The behavior comes from a third-party report, updated 2026-05-01, that folderOpen tasks run when a folder is opened (${OASIS_REPORT}); it is not an official source and was not tested. Field names are VS Code's (${VSCODE_TASKS}), and its setting task.allowAutomaticTasks may also apply. The format is written as jsonc from VS Code convention and was not read on either page. Cursor has a second, documented mechanism that this field cannot hold: a workspaceOpen hook, listed under hooks.`,
  ),
  extensions: uncertain(
    {
      subagents: [
        project('.cursor/agents/*.md', 'markdown-frontmatter'),
        project('.claude/agents/*.md', 'markdown-frontmatter'),
        project('.codex/agents/*.md', 'markdown-frontmatter'),
        user('~/.cursor/agents/*.md', 'markdown-frontmatter'),
        user('~/.claude/agents/*.md', 'markdown-frontmatter'),
        user('~/.codex/agents/*.md', 'markdown-frontmatter'),
      ],
      commands: [project('.cursor/commands/*.md', 'markdown')],
    },
    SUBAGENTS,
    `Subagents are verified on this page: project wins over user for one name, and .cursor wins over .claude and .codex. Commands are the uncertain part: the project path comes only from a 2025 changelog (${COMMANDS_CHANGELOG}), and no current documentation page for them was found. Cursor's skills migration text confirms user-level commands exist, but their path was not read on an official page, so ~/.cursor/commands is left out. Commands may have frontmatter; the plugin reference documents that for plugins only.`,
  ),
};
