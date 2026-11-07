import { verifiedOn } from './define.ts';
import type { AgentKnowledge, AgentPath, ContextFile, ExtensionsKnowledge, McpKnowledge, Scope } from './types.ts';

const { verified, uncertain, disputed, evidence } = verifiedOn('2026-11-06');
// Read on 2026-11-07, once docs.devin.ai could be reached from the session (Q-011).
const later = verifiedOn('2026-11-07');

// Windsurf was renamed Devin Desktop, and docs.windsurf.com redirects to docs.devin.ai, so these pages are its official documentation.
const DOCS = 'https://docs.devin.ai';
const CONFIG_FILE = `${DOCS}/cli/reference/configuration/config-file.md`;
const PRECEDENCE = `${DOCS}/cli/reference/configuration/global-vs-local.md`;
const READ_CONFIG_FROM = `${DOCS}/cli/reference/configuration/read-config-from.md`;
const PERMISSIONS = `${DOCS}/cli/reference/permissions.md`;
const CREATING_SKILLS = `${DOCS}/cli/extensibility/skills/creating-skills.md`;
const MCP = `${DOCS}/cli/extensibility/mcp/configuration.md`;
const HOOKS = `${DOCS}/cli/extensibility/hooks/overview.md`;
const SKILLS = `${DOCS}/cli/extensibility/skills/overview.md`;
const RULES = `${DOCS}/cli/extensibility/rules.md`;
const SUBAGENTS = `${DOCS}/cli/subagents.md`;
const WORKFLOWS = `${DOCS}/desktop/cascade`;
const CASCADE = `${DOCS}/desktop/cascade.md`;
const CUSTOMIZATIONS = `${DOCS}/desktop/devin-local/customizations.md`;
const CONTROLS = `${DOCS}/desktop/controls`;
const FAQ = `${DOCS}/desktop/devin-desktop-faq`;
const VSCODE_TASKS = 'https://code.visualstudio.com/docs/debugtest/tasks';

const POSIX = ['linux', 'darwin'] as const;
const WIN32 = ['win32'] as const;
const CHANNELS = ['windsurf', 'windsurf-next', 'windsurf-insiders'] as const;

const SYSTEM_DIRECTORIES = [
  { base: '/etc/devin', platform: 'linux' },
  { base: '/Library/Application Support/Devin', platform: 'darwin' },
  { base: 'C:/ProgramData/Devin', platform: 'win32' },
  { base: '/etc/windsurf', platform: 'linux' },
  { base: '/Library/Application Support/Windsurf', platform: 'darwin' },
  { base: 'C:/ProgramData/Windsurf', platform: 'win32' },
] as const;

function managed(file: string, format: AgentPath['format']): AgentPath[] {
  return SYSTEM_DIRECTORIES.map(({ base, platform }) => ({ path: `${base}/${file}`, scope: 'managed', format, platforms: [platform] }));
}

function devinUser(file: string, format: AgentPath['format']): AgentPath[] {
  return [
    { path: `~/.config/devin/${file}`, scope: 'user', format, platforms: POSIX },
    { path: `%APPDATA%/devin/${file}`, scope: 'user', format, platforms: WIN32 },
  ];
}

const projectConfig: readonly AgentPath[] = [
  { path: '.devin/config.local.json', scope: 'project', format: 'json' },
  { path: '.devin/config.json', scope: 'project', format: 'json' },
];

const configFiles: readonly AgentPath[] = [...projectConfig, ...devinUser('config.json', 'json')];

const mcpFiles: readonly AgentPath[] = [
  { path: '.devin/mcp_config.local.json', scope: 'project', format: 'json' },
  { path: '.devin/mcp_config.json', scope: 'project', format: 'json' },
  ...devinUser('mcp_config.json', 'json'),
];

// Before v3000.3, servers sat under mcpServers in the main config files; newer versions migrate them on startup.
const legacyConfigMcp: readonly AgentPath[] = configFiles;

function mcpWith(legacy: readonly AgentPath[]): McpKnowledge {
  return {
    files: [...mcpFiles, ...legacyConfigMcp, ...legacy],
    serversKey: 'mcpServers',
    local: { command: 'command', args: 'args', env: 'env' },
    remote: { url: 'url', headers: 'headers', otherUrls: ['serverUrl'] },
  };
}

function context(path: string, scope: Scope, loading: ContextFile['loading'], format: AgentPath['format'] = 'markdown'): ContextFile {
  return { path, scope, format, loading };
}

const subagents: readonly AgentPath[] = [
  { path: '.devin/agents', scope: 'project', format: 'markdown-frontmatter' },
  { path: '.agents/agents', scope: 'project', format: 'markdown-frontmatter' },
  ...devinUser('agents', 'markdown-frontmatter'),
];

const workflows: ExtensionsKnowledge = {
  subagents,
  commands: [
    { path: '**/.devin/workflows/*.md', scope: 'project', format: 'markdown' },
    { path: '**/.windsurf/workflows/*.md', scope: 'project', format: 'markdown' },
    { path: '~/.codeium/windsurf/global_workflows/*.md', scope: 'user', format: 'markdown' },
    ...managed('workflows/*.md', 'markdown'),
  ],
};

export const windsurf: AgentKnowledge = {
  id: 'windsurf',
  name: 'Windsurf (Devin Desktop)',
  precedence: verified(
    configFiles,
    PRECEDENCE,
    `Organization settings from the admin dashboard and session approvals rank above these files and have no file. In .devin/config.json only permissions, read_config_from and hooks are available. The older IDE settings live in VS Code-derived per-user directories and in the binary ~/.codeium/user_settings.pb (${FAQ}), which is not listed here.`,
  ),
  mcp: disputed(
    `A project file exists now (${MCP}); which file wins for one server is not documented. Versions before v3000.3 kept servers under mcpServers in .devin/config.json, .devin/config.local.json and the user config.json, and newer ones migrate them on startup (same page, read on 2026-11-07), so those files are read too. Sources disagree on the legacy user file. read_config_from.windsurf defaults to true, and read_config_from also imports .mcp.json, .cursor/mcp.json and other tools' files; those belong to their own agents, except OpenCode's opencode.json and Zed's .zed/settings.json (key context_servers), which agentcurfew does not read yet, and ~/.claude/mcp_servers.json (${READ_CONFIG_FROM}, read on 2026-11-07). The docs read in phase 1 name url for remote servers and do not mention serverUrl, while a search summary of https://docs.windsurf.com/windsurf/cascade/mcp on 2026-11-06 (the page itself could not be fetched) says a remote server needs serverUrl or url; both are read. The field in legacy files could not be read from an official page.`,
    later.evidence(mcpWith(CHANNELS.map((channel) => ({ path: `~/.codeium/${channel}/mcp_config.json`, scope: 'user', format: 'json' }))), READ_CONFIG_FROM),
    later.evidence(mcpWith([{ path: '~/.codeium/mcp_config.json', scope: 'user', format: 'json' }]), FAQ),
  ),
  hooks: verified(
    {
      files: [
        { path: '**/.devin/hooks.v1.json', scope: 'project', format: 'json', key: null },
        ...projectConfig,
        { path: '.claude/settings.json', scope: 'project', format: 'json' },
        { path: '.claude/settings.local.json', scope: 'project', format: 'json' },
        ...devinUser('config.json', 'json'),
        { path: '~/.claude.json', scope: 'user', format: 'json' },
        { path: '~/.claude/settings.json', scope: 'user', format: 'json' },
        { path: '~/.claude/settings.local.json', scope: 'user', format: 'json' },
        ...managed('hooks.json', 'json'),
      ],
      key: 'hooks',
      events: ['PreToolUse', 'PostToolUse', 'PermissionRequest', 'UserPromptSubmit', 'Stop', 'PostCompaction', 'SessionStart', 'SessionEnd'],
      handlerTypes: ['command', 'prompt'],
      commandField: 'command',
    },
    HOOKS,
    `In .devin/hooks.v1.json the hooks object is the whole file, with no hooks key. Project files are found from the working directory up to the repository root. Merge order is not documented. Only exit code 2 blocks; other failures, timeouts and unreadable output do not. Hooks do not load in Restricted Mode. The system hooks.json comes from ${CONTROLS}, which gives neither its key nor its format. The changelog has a command that migrates Windsurf hooks. The Cascade reference shows legacy Cascade hooks in .windsurf/hooks.json (${CASCADE}, read on 2026-11-07), but Cascade no longer runs, so that file is not listed.`,
  ),
  skills: later.verified(
    {
      directories: [
        { path: '.devin/skills', scope: 'project', format: 'markdown-frontmatter' },
        { path: '.agents/skills', scope: 'project', format: 'markdown-frontmatter' },
        { path: '.windsurf/skills', scope: 'project', format: 'markdown-frontmatter' },
        ...devinUser('skills', 'markdown-frontmatter'),
        { path: '~/.agents/skills', scope: 'user', format: 'markdown-frontmatter' },
        ...CHANNELS.map((channel): AgentPath => ({ path: `~/.codeium/${channel}/skills`, scope: 'user', format: 'markdown-frontmatter' })),
        ...managed('skills', 'markdown-frontmatter'),
      ],
      entryFile: 'SKILL.md',
      grantsField: 'allowed-tools',
    },
    SKILLS,
    `Precedence between locations is not documented. The system directories come from ${CONTROLS}, where the Windsurf ones are fallbacks used only when the Devin path is missing. Skills from .claude/skills, .claude/commands and .github/skills are imported through read_config_from (${READ_CONFIG_FROM}). The allowed-tools frontmatter auto-approves the tools it lists when a skill runs inline (${CREATING_SKILLS}, read on 2026-11-07), and the docs warn that third-party skills can execute arbitrary code.`,
  ),
  contextFiles: verified(
    [
      context('AGENTS.md', 'project', 'always'),
      context('AGENTS.local.md', 'project', 'always'),
      context('AGENT.md', 'project', 'always'),
      context('.windsurfrules', 'project', 'always'),
      context('**/AGENTS.md', 'project', 'conditional'),
      context('**/.devin/global_rules.md', 'project', 'always'),
      context('**/.windsurf/global_rules.md', 'project', 'always'),
      context('**/.devin/rules/*.md', 'project', 'conditional', 'markdown-frontmatter'),
      context('**/.windsurf/rules/*.md', 'project', 'conditional', 'markdown-frontmatter'),
      { path: '~/.config/devin/AGENTS.md', scope: 'user', format: 'markdown', platforms: POSIX, loading: 'always' },
      { path: '%APPDATA%/devin/AGENTS.md', scope: 'user', format: 'markdown', platforms: WIN32, loading: 'always' },
      context('~/.devin/global_rules.md', 'user', 'always'),
      context('~/.devin/rules/*.md', 'user', 'conditional', 'markdown-frontmatter'),
      ...managed('rules/*.md', 'markdown-frontmatter').map((file): ContextFile => ({ ...file, loading: 'conditional' })),
    ],
    RULES,
    `Rules in subdirectories load lazily, when the agent accesses files there. When both global_rules.md files exist only the .devin one loads, while both rules folders load. A rule's load condition is its trigger frontmatter; the CLI page lists always_on, manual, model_decision, agent and glob, the Desktop page omits agent. The system rules come from ${CONTROLS}. CLAUDE.md, ~/.claude/CLAUDE.md and .cursor/rules are also imported and belong to their own agents. The storage path of memories and the older global rules file under ~/.codeium are not documented on any page read; the changelog only has a wizard that migrates memories.`,
  ),
  permissions: later.verified(
    {
      files: configFiles,
      keys: ['permissions.allow', 'permissions.deny', 'permissions.ask', 'permission_mode', 'local_tools_bypass_permissions', 'read_config_from'],
      bypass: [
        { key: 'permission_mode', value: 'dangerous', fromProject: 'ignored' },
        { key: 'local_tools_bypass_permissions', value: true, fromProject: 'ignored' },
        { key: 'permissions.allow', value: 'mcp__*' },
      ],
      allowAllShell: [{ key: 'permissions.allow', value: 'exec' }],
    },
    CONFIG_FILE,
    `permission_mode and local_tools_bypass_permissions are user-only; project files can set only permissions, read_config_from and hooks, so a repository cannot turn prompts off through them. The UI calls the mode Bypass, and the file value is dangerous. Deny and ask rules still apply under local_tools_bypass_permissions, and a deny always wins. Project files can set permissions, so a committed allow of the tool name exec ("Block all command execution" is its deny example; the tool names are read, edit, grep, glob and exec) or of mcp__* ("All MCP tools everywhere") lets those run without a prompt: "Allow rules — If matched, the action proceeds without prompting" (${PERMISSIONS}, read on 2026-11-07). The legacy Cascade command allow and deny lists are team settings (${CONTROLS}); no current page gives a file key for them.`,
  ),
  autoRun: uncertain(
    {
      files: [{ path: '.vscode/tasks.json', scope: 'project', format: 'jsonc' }],
      containerKey: 'tasks',
      triggerKey: 'runOptions.runOn',
      triggerValue: 'folderOpen',
      commandField: 'command',
    },
    VSCODE_TASKS,
    `Inferred from VS Code, not from Devin Desktop docs: the FAQ calls its data directory VS Code-derived and its docs say nothing about automatic tasks. In VS Code the task.allowAutomaticTasks setting gates them, and they never run in untrusted workspaces. Separately, Desktop documents devcontainer.json lifecycle commands, where initializeCommand runs on the host once the folder is trusted (${DOCS}/desktop/advanced).`,
  ),
  extensions: disputed(
    `Sources disagree on whether workflows still run: the workflows page documents them and calls them Cascade-only, unsupported by Devin Local, while the changelog says v3.9.19 (2026-09-08) removed Cascade and Devin Local is the only agent (${DOCS}/desktop/changelog). The Cascade reference, read on 2026-11-07, sides with the changelog: "Devin Desktop no longer starts new Cascade conversations and no longer opens old ones" (${CASCADE}). Files may therefore be inert on current versions and live on older ones, so both are kept. Skills are invoked as /skill-name.`,
    evidence(workflows, WORKFLOWS),
    evidence({ subagents, commands: [] }, `${DOCS}/desktop/changelog`),
  ),
  // Each from a page that calls the path legacy or a fallback; the old paths are still read (Q-011).
  deprecations: [
    later.verified(
      { paths: ['.windsurfrules'], replacement: 'rules in .devin/rules/*.md, or .devin/global_rules.md' },
      CUSTOMIZATIONS,
      'The page: "The legacy .windsurf/rules/*.md, .windsurf/global_rules.md, and .windsurfrules files are imported by default."',
    ),
    later.verified(
      { paths: ['**/.windsurf/rules/*.md'], replacement: '.devin/rules/*.md' },
      CUSTOMIZATIONS,
      'Called legacy; rule files in both .devin/rules/ and .windsurf/rules/ load.',
    ),
    later.verified(
      { paths: ['**/.windsurf/global_rules.md'], replacement: '.devin/global_rules.md' },
      CUSTOMIZATIONS,
      'Called legacy; when both global_rules.md files exist, only .devin/global_rules.md loads, so the old one is then ignored.',
    ),
    later.verified(
      { paths: ['.windsurf/skills'], replacement: '.devin/skills/<name>/' },
      CUSTOMIZATIONS,
      'The page: ".agents/skills/ and the legacy .windsurf/skills/ are also read".',
    ),
    later.verified(
      { paths: ['**/.windsurf/workflows/*.md', ...SYSTEM_DIRECTORIES.filter(({ base }) => base.includes('indsurf')).map(({ base }) => `${base}/workflows/*.md`)], replacement: '.devin/workflows/*.md, or the Devin system directory' },
      CASCADE,
      'The page calls .windsurf/workflows/ legacy and a fallback, and the Windsurf system directories a legacy fallback, read only when the Devin one is missing. Workflows belong to Cascade, which no longer starts conversations (see extensions).',
    ),
  ],
};
