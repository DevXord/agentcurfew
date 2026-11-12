import { verifiedOn } from './define.ts';
import type { AgentKnowledge, AgentPath, ContextFile } from './types.ts';

// Read again in knowledge review W1 (2026-11-12): the files cited under SOURCE are identical at ea16751 and 92b9f72.
const { verified, uncertain } = verifiedOn('2026-11-12');

const DOCS = 'https://docs.cline.bot';
const SOURCE = 'https://github.com/cline/cline/blob/92b9f722a16d2a03c1153e12f9a0e759455f509d';

const CONFIG_DOC = `${DOCS}/getting-started/config.md`;
const RULES_DOC = `${DOCS}/customization/cline-rules.md`;
const SDK_PATHS = `${SOURCE}/sdk/packages/shared/src/storage/paths.ts`;
const EXTENSION_DISK = `${SOURCE}/apps/vscode/src/core/storage/disk.ts`;
const HOOK_FILE_CONFIG = `${SOURCE}/sdk/packages/core/src/hooks/hook-file-config.ts`;
const STORAGE_CONTEXT = `${SOURCE}/apps/vscode/src/shared/storage/storage-context.ts`;
const CRON_ARCHITECTURE = `${SOURCE}/sdk/ARCHITECTURE.md`;

const project = (path: string, format: AgentPath['format']): AgentPath => ({ path, scope: 'project', format });
const user = (path: string, format: AgentPath['format']): AgentPath => ({ path, scope: 'user', format });
const projectRule = (path: string, loading: ContextFile['loading'], format: AgentPath['format'] = 'markdown-frontmatter'): ContextFile => ({ ...project(path, format), loading });
const userRule = (path: string, loading: ContextFile['loading'], format: AgentPath['format'] = 'markdown-frontmatter'): ContextFile => ({ ...user(path, format), loading });

const MCP_SETTINGS = user('~/.cline/data/settings/cline_mcp_settings.json', 'json');
const GLOBAL_SETTINGS = user('~/.cline/data/settings/global-settings.json', 'json');

export const cline: AgentKnowledge = {
  id: 'cline',
  name: 'Cline',
  precedence: uncertain(
    [
      project('.clinerules', 'markdown-frontmatter'),
      project('.cline/rules', 'markdown-frontmatter'),
      user('~/.cline/rules', 'markdown-frontmatter'),
      user('~/Cline/Rules', 'markdown-frontmatter'),
      user('~/Documents/Cline/Rules', 'markdown-frontmatter'),
    ],
    RULES_DOC,
    'Only the rules page states an order: workspace rules win over global ones. The order inside each group is the search order of resolveRulesConfigSearchPaths in the SDK, not a documented ranking. Cline has no single layered settings chain: the config page says only that global and project config work together, MCP servers and settings exist only at user level, and skills go the other way round (a global skill beats a project skill of the same name).',
  ),
  mcp: verified(
    {
      files: [MCP_SETTINGS],
      serversKey: 'mcpServers',
      local: { command: 'command', args: 'args', env: 'env' },
      remote: { url: 'url', headers: 'headers' },
    },
    CONFIG_DOC,
    `One file shared by the CLI, the SDK and the IDE extensions, with no project-level file: resolveMcpSettingsPath in ${SDK_PATHS} and getSharedMcpSettingsPath in ${SOURCE}/apps/vscode/src/hosts/vscode/mcp-settings-legacy-migration.ts. The path is not platform-specific, and the VS Code global storage location is now only a one-time migration source, together with Documents/Cline/MCP. CLINE_MCP_SETTINGS_PATH replaces the file; CLINE_DATA_DIR and CLINE_DIR move it. Other fields of an entry: type (stdio, sse, streamableHttp; a url without type means sse), the legacy transportType, cwd, disabled, timeout, and autoApprove, which ${SOURCE}/apps/vscode/src/services/mcp/schemas.ts accepts but ${SOURCE}/sdk/packages/core/src/extensions/mcp/config-loader.ts does not list. ~/.agents/plugins can also bring MCP servers, and only the home directory is searched for them.`,
  ),
  hooks: verified(
    {
      files: [
        project('.clinerules/hooks/*', 'text'),
        project('.cline/hooks/*', 'text'),
        user('~/Documents/Cline/Hooks/*', 'text'),
        user('~/.cline/hooks/*', 'text'),
        project('.cline/plugins/*', 'text'),
        user('~/.cline/plugins/*', 'text'),
        user('~/Documents/Cline/Plugins/*', 'text'),
      ],
      key: null,
      events: ['TaskStart', 'TaskResume', 'TaskCancel', 'TaskComplete', 'TaskError', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'PreCompact', 'SessionShutdown'],
      handlerTypes: ['executable-file', 'plugin-module'],
      commandField: null,
    },
    SDK_PATHS,
    `Types: the file itself is the handler, so key and commandField are null, and plugins are listed here because a plugin is .js or .ts code that registers lifecycle hooks and loads from the workspace with no approval step found (${SOURCE}/sdk/packages/core/src/extensions/plugin/plugin-config-loader.ts filters only by the user's disabledPlugins). The lists are unions of two hosts. The SDK and CLI search all four hook folders and name events as in ${HOOK_FILE_CONFIG}: the file name is the event in any case, with no extension or .sh, .bash, .zsh, .js, .mjs, .cjs, .ts, .mts, .cts, .py or .ps1. The VS Code extension has its own list in ${SOURCE}/apps/vscode/src/core/hooks/utils.ts (with Notification, without TaskError and SessionShutdown), and its helpers name .clinerules/hooks and ~/Documents/Cline/Hooks, an exact event name on Unix and <event>.ps1 on Windows. The 2025 blog post's ~/Documents/Cline/Rules/Hooks and "macOS and Linux only" are out of date. CLINE_HOOKS_DIR and --hooks-dir add a folder. The hooksEnabled setting defaults to true.`,
  ),
  skills: verified(
    {
      directories: [
        project('.clinerules/skills', 'markdown-frontmatter'),
        project('.cline/skills', 'markdown-frontmatter'),
        project('.claude/skills', 'markdown-frontmatter'),
        project('.agents/skills', 'markdown-frontmatter'),
        user('~/.cline/skills', 'markdown-frontmatter'),
        user('~/.agents/skills', 'markdown-frontmatter'),
      ],
      entryFile: 'SKILL.md',
    },
    SDK_PATHS,
    `Search order of resolveSkillsConfigSearchPaths. ${DOCS}/customization/skills.md lists three project folders and recommends .cline/skills; ${CONFIG_DOC} adds the .agents folders. Frontmatter: name (must equal the folder name) and description (at most 1024 characters). A global skill wins over a project skill of the same name, and enabled skills can also be started as slash commands.`,
  ),
  contextFiles: verified(
    [
      projectRule('AGENTS.md', 'always', 'markdown'),
      projectRule('.clinerules', 'always'),
      projectRule('.clinerules/*', 'conditional'),
      projectRule('.cline/rules/*', 'conditional'),
      userRule('~/.agents/AGENTS.md', 'always', 'markdown'),
      userRule('~/.cline/rules/*', 'conditional'),
      userRule('~/Cline/Rules/*', 'conditional'),
      userRule('~/Documents/Cline/Rules/*', 'conditional'),
      projectRule('.cursorrules', 'always', 'text'),
      projectRule('.cursor/rules/*.mdc', 'conditional'),
      projectRule('.windsurfrules', 'always', 'text'),
    ],
    RULES_DOC,
    `Rule files end in .md, .markdown or .txt. A rule without frontmatter is always active, and frontmatter paths narrows it to matching files, so folder entries are marked conditional only because they can be; invalid YAML fails open and the rule is active. .clinerules may be a single file: ${SOURCE}/apps/vscode/src/core/context/instructions/user-instructions/cline-rules.ts accepts that name without an extension, though the docs describe only the folder. .cursorrules, .cursor/rules and .windsurfrules are VS Code extension behaviour (${EXTENSION_DISK}); the SDK paths do not name them, and the rules page does not mention .cursor/rules. On Windows the global folder is also looked for under the OneDrive, OneDriveConsumer and OneDriveCommercial variables.`,
  ),
  permissions: uncertain(
    {
      files: [GLOBAL_SETTINGS, MCP_SETTINGS, user('~/.cline/data/globalState.json', 'json')],
      keys: ['toolAutoApprove', 'disabledTools', 'mcpServers.*.autoApprove', 'autoApprovalSettings.actions.*'],
      bypass: [{ key: 'toolAutoApprove', value: true }],
    },
    `${SOURCE}/sdk/packages/core/src/services/global-settings.ts`,
    `All three files are user-level; no project-level permissions file was found, and ${DOCS}/features/auto-approve.md describes only the UI, including YOLO mode. Inferred, not stated: that toolAutoApprove in global-settings.json turns prompts off (only its name and type were read), and that autoApprovalSettings is stored in globalState.json (${SOURCE}/apps/vscode/src/shared/storage/state-keys.ts defines the key and ${STORAGE_CONTEXT} names the file). No key for YOLO mode was found in state-keys.ts. ${DOCS}/cli/cli-reference.md says the CLI has no allow or deny list for shell commands, and --auto-approve defaults to true outside ACP mode. Administrators can set yoloModeAllowed by remote configuration, not by a file.`,
  ),
  autoRun: uncertain(
    {
      files: [
        project('.cline/cron/*.md', 'markdown-frontmatter'),
        project('.cline/cron/**/*.cron.md', 'markdown-frontmatter'),
        project('.cline/cron/events/*.event.md', 'markdown-frontmatter'),
        user('~/.cline/cron/*.md', 'markdown-frontmatter'),
        user('~/.cline/cron/**/*.cron.md', 'markdown-frontmatter'),
        user('~/.cline/cron/events/*.event.md', 'markdown-frontmatter'),
      ],
      triggerKey: 'enabled',
      triggerValue: 'true',
      commandField: 'prompt',
    },
    CRON_ARCHITECTURE,
    `Types: the trigger is the file's presence, not a field; enabled defaults to true, so a spec that omits it runs, and the command is an agent prompt rather than a shell command. Read from code, never run. ${SOURCE}/sdk/packages/core/src/cron/specs/cron-spec-parser.ts defaults mode to yolo and requires prompt and workspaceRoot; ${SOURCE}/sdk/packages/core/src/cron/runner/cron-materializer.ts queues every enabled one-off spec; ${SOURCE}/sdk/packages/core/src/cron/runner/cron-runner.ts sets autoApprove on all tools. ARCHITECTURE.md says normal CLI and hub startup watches the workspace .cline/cron without opting in, but ${DOCS}/sdk/guides/scheduled-agents.md names only ~/.cline/cron, and the hub wiring itself was not read. Unknown: whether workspaceRoot must match the watched workspace, and whether a provider or anything else stops a fresh clone from running. Not checked for the VS Code extension. .cline/cron/reports holds generated reports. No field that starts a command on folder open was found. cron-reconciler.ts reads the global ~/.cline/cron by default; the workspace folder is used only when the host passes scope workspace (92b9f72), which disagrees with ARCHITECTURE.md, so both folders stay listed.`,
  ),
  extensions: verified(
    {
      subagents: [project('.cline/agents/*', 'markdown-frontmatter'), user('~/.cline/agents/*', 'markdown-frontmatter')],
      commands: [
        project('.clinerules/workflows/*', 'markdown-frontmatter'),
        project('.cline/workflows/*', 'markdown-frontmatter'),
        user('~/Documents/Cline/Workflows/*', 'markdown-frontmatter'),
        user('~/.cline/workflows/*', 'markdown-frontmatter'),
      ],
    },
    SDK_PATHS,
    `Agent definitions are .yml or .yaml files that hold a YAML frontmatter block (${SOURCE}/sdk/packages/core/src/extensions/tools/team/configured-agent-config.ts). The commands entry is Cline's workflows. ${EXTENSION_DISK} names .clinerules/workflows as the workspace folder of the VS Code extension.`,
  ),
};
