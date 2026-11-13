import { verifiedOn } from './define.ts';
import type { AgentKnowledge, AgentPath, ContextFile, SkillsKnowledge } from './types.ts';

const { verified, uncertain, disputed, evidence } = verifiedOn('2026-11-06');
// Facts changed after the source audit of 2026-11-07, read again that day.
const later = verifiedOn('2026-11-07');
// Read again in knowledge review W1 (2026-11-12).
const w1 = verifiedOn('2026-11-12');

const SETTINGS = 'https://code.visualstudio.com/docs/configure/settings';
const MCP_REFERENCE = 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration';
const MCP_GUIDE = 'https://code.visualstudio.com/docs/agent-customization/mcp-servers';
const HOOKS_REFERENCE = 'https://docs.github.com/en/copilot/reference/hooks-reference';
const HOOKS_GUIDE = 'https://code.visualstudio.com/docs/agent-customization/hooks';
const LOCAL_HOOKS = 'https://code.visualstudio.com/docs/agents/reference/hooks-reference';
const SKILLS = 'https://code.visualstudio.com/docs/agent-customization/agent-skills';
const MIGRATE = 'https://code.visualstudio.com/docs/agent-customization/migrate-customizations';
const INSTRUCTIONS = 'https://code.visualstudio.com/docs/agents/reference/custom-instructions-reference';
const APPROVALS = 'https://code.visualstudio.com/docs/agents/run/approvals';
const AI_SETTINGS = 'https://code.visualstudio.com/docs/agents/reference/ai-settings';
const TASKS = 'https://code.visualstudio.com/docs/debugtest/tasks';
const AGENTS = 'https://code.visualstudio.com/docs/agents/reference/custom-agent-file-reference';
const PROMPTS = 'https://code.visualstudio.com/docs/agent-customization/prompt-files';
const CLI_REFERENCE = 'https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference';
const CLI_INSTRUCTIONS = 'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions';

const WORKSPACE_SETTINGS: AgentPath = { path: '.vscode/settings.json', scope: 'project', format: 'json' };
const USER_SETTINGS: readonly AgentPath[] = [
  { path: '~/.config/Code/User/settings.json', scope: 'user', format: 'json', platforms: ['linux'] },
  { path: '~/Library/Application Support/Code/User/settings.json', scope: 'user', format: 'json', platforms: ['darwin'] },
  { path: '%APPDATA%/Code/User/settings.json', scope: 'user', format: 'json', platforms: ['win32'] },
  // A profile scopes the user settings to itself (${SETTINGS}).
  { path: '~/.config/Code/User/profiles/*/settings.json', scope: 'user', format: 'json', platforms: ['linux'] },
  { path: '~/Library/Application Support/Code/User/profiles/*/settings.json', scope: 'user', format: 'json', platforms: ['darwin'] },
  { path: '%APPDATA%/Code/User/profiles/*/settings.json', scope: 'user', format: 'json', platforms: ['win32'] },
];

const skills = (directories: readonly string[]): SkillsKnowledge => ({
  directories: directories.map((path) => ({ path, scope: path.startsWith('~/') ? 'user' : 'project', format: 'markdown-frontmatter' })),
  entryFile: 'SKILL.md',
});

const context = (path: string, format: ContextFile['format'], loading: ContextFile['loading']): ContextFile => ({
  path,
  scope: path.startsWith('~/') ? 'user' : 'project',
  format,
  loading,
});

export const copilotVscode: AgentKnowledge = {
  id: 'copilot-vscode',
  name: 'GitHub Copilot in VS Code',
  precedence: verified(
    [WORKSPACE_SETTINGS, ...USER_SETTINGS],
    SETTINGS,
    'Winner first. The full order, last wins: default, user, remote, workspace, workspace folder, the language-specific forms of those, then policy settings, which beat everything and have no file here. The Windows path is written as the page gives it, with %APPDATA% in place of ~/. These are editor settings; the Copilot harness reads separate Copilot files, and the pages name .github/copilot/settings.json, .github/copilot/settings.local.json and ~/.copilot/settings.json only as sources of inline hooks, with no order against the editor settings.',
  ),
  mcp: later.verified(
    {
      files: [
        { path: '.vscode/mcp.json', scope: 'project', format: 'json' },
        { path: '.mcp.json', scope: 'project', format: 'json', serversKey: 'mcpServers' },
        { path: '~/.copilot/mcp-config.json', scope: 'user', format: 'json', serversKey: 'mcpServers' },
      ],
      serversKey: 'servers',
      local: { command: 'command', args: 'args', env: 'env' },
      remote: { url: 'url', headers: 'headers' },
    },
    MCP_REFERENCE,
    `The VS Code format also exists as mcp.json in the user profile, per profile, with no on-disk path in the docs. The portable format uses the top-level key mcpServers in .mcp.json at the workspace root, which is always read (the experimental chat.mcp.workspaceRootConfig.enabled only controls whether MCP: Add Server offers it as a destination: "Existing .mcp.json files remain available when this setting is off", read on 2026-11-07) and in $COPILOT_HOME/mcp-config.json, falling back to ~/.copilot/mcp-config.json. With chat.mcp.discovery.enabled VS Code also reads the configuration of other agents, such as Claude Desktop, Cursor and Windsurf. Copilot harness sessions read the portable format directly and do not read .vscode/mcp.json; VS Code forwards its eligible servers, leaving out those that need \${input:...} or \${command:...}. ${MCP_GUIDE} labels .vscode/mcp.json and the profile file deprecated in its guided flow; the reference does not. Both type and the fields above are per server: stdio needs type and command, http and sse need type and url. cwd, envFile and input variables exist only in the VS Code format; the portable format's server fields were not checked one by one.`,
  ),
  hooks: verified(
    {
      files: [
        { path: '.github/hooks/*.json', scope: 'project', format: 'json' },
        { path: '.github/copilot/settings.json', scope: 'project', format: 'json' },
        { path: '.github/copilot/settings.local.json', scope: 'project', format: 'json' },
        { path: '.claude/settings.json', scope: 'project', format: 'json' },
        { path: '.claude/settings.local.json', scope: 'project', format: 'json' },
        { path: '~/.copilot/hooks/*.json', scope: 'user', format: 'json' },
        { path: '~/.copilot/settings.json', scope: 'user', format: 'json' },
      ],
      key: 'hooks',
      events: [
        'agentStop',
        'errorOccurred',
        'notification',
        'permissionRequest',
        'postToolUse',
        'postToolUseFailure',
        'preCompact',
        'preToolUse',
        'sessionEnd',
        'sessionStart',
        'subagentStart',
        'subagentStop',
        'userPromptSubmitted',
        'userPromptTransformed',
      ],
      handlerTypes: ['command', 'http', 'prompt'],
      commandField: 'command',
    },
    HOOKS_REFERENCE,
    `Describes the Copilot harness; ${HOOKS_GUIDE} says the VS Code hooks experience is in Preview. A command hook may instead hold the command in bash or powershell. ~/.copilot/hooks moves to $COPILOT_HOME/hooks when that is set. The GitHub reference also lists machine-wide policy files (/etc/github-copilot/policy.d/*.json, C:\\ProgramData\\GitHub\\Copilot\\policy.d\\*.json), plugin hooks.json files and agent frontmatter, and marks exec, args and frontmatter hooks CLI only, while the VS Code guide says exec and args are available and describes agent-scoped hooks. The Local harness differs (${LOCAL_HOOKS}): events PreToolUse, PostToolUse, UserPromptSubmit, SessionStart, Stop, SubagentStart, SubagentStop and PreCompact; type must be command; command may be overridden by windows, linux or osx. chat.useHooks controls the Local harness only, chat.hookFilesLocations adds Local locations, and chat.useClaudeHooks is required for Claude settings files in Local sessions.`,
  ),
  skills: disputed<SkillsKnowledge | null>(
    `The two pages disagree on whether the Copilot harness reads .agents/skills and ~/.agents/skills. Both variants hold the Copilot harness only: Local sessions also read .agents/skills, .claude/skills, ~/.agents/skills and ~/.claude/skills. The deprecated chat.agentSkillsLocations adds locations for Local sessions. Read again on 2026-11-12: the skills page now calls its table "a supported project and personal location for each harness, not every directory it recognizes", the migration page says "VS Code and GitHub Copilot CLI read the same Copilot customization files", and the Copilot CLI reference loads skills from .github/skills, .agents/skills and .claude/skills in the project and ~/.copilot/skills and ~/.agents/skills in the home folder (${CLI_REFERENCE}), which favors the second variant. The Local harness is deprecated and will be removed in February 2027.`,
    w1.evidence(skills(['.github/skills', '~/.copilot/skills']), SKILLS, 'Lists .agents/skills under the Codex harness, not under Copilot.'),
    w1.evidence(skills(['.github/skills', '.agents/skills', '~/.copilot/skills', '~/.agents/skills']), MIGRATE),
  ),
  contextFiles: w1.verified(
    [
      context('.github/copilot-instructions.md', 'markdown', 'always'),
      context('AGENTS.md', 'markdown', 'always'),
      context('CLAUDE.md', 'markdown', 'always'),
      context('.claude/CLAUDE.md', 'markdown', 'always'),
      context('CLAUDE.local.md', 'markdown', 'always'),
      context('.github/instructions/**/*.instructions.md', 'markdown-frontmatter', 'conditional'),
      context('**/AGENTS.md', 'markdown', 'conditional'),
      context('.claude/rules/*.md', 'markdown-frontmatter', 'conditional'),
      context('~/.copilot/copilot-instructions.md', 'markdown', 'always'),
      context('~/.copilot/instructions/**/*.instructions.md', 'markdown-frontmatter', 'conditional'),
      context('~/.claude/CLAUDE.md', 'markdown', 'always'),
      context('~/.claude/rules/*.md', 'markdown-frontmatter', 'conditional'),
      context('~/.codex/AGENTS.md', 'markdown', 'always'),
    ],
    INSTRUCTIONS,
    'The union of the Copilot, Local, Claude and Codex harnesses of VS Code, since the harness is chosen per session. The reference table does not label activation; loading is read from its descriptions and the custom instructions guide. A .claude/rules file without paths applies generally. ~/.codex is the default Codex home. Neither VS Code page names GEMINI.md or says whether .claude/rules is searched recursively, but the reference points to the Copilot instruction locations, which list GEMINI.md (${CLI_INSTRUCTIONS}), and the Copilot CLI reference reads GEMINI.md and .claude/rules/**/*.md "In Git root and cwd" (${CLI_REFERENCE}); this fact does not list them yet, and the scan of the Copilot runtime\'s files comes with agentcurfew 1.6.0-a (read on 2026-11-12). Local gating settings, in the AI settings reference: github.copilot.chat.codeGeneration.useInstructionFiles, chat.useAgentsMdFile, chat.useNestedAgentsMdFiles (off by default), chat.useClaudeMdFile, chat.includeApplyingInstructions, chat.instructionsFilesLocations. Local user instructions live in the profile, with no path given.',
  ),
  permissions: w1.uncertain(
    {
      files: [WORKSPACE_SETTINGS, { path: '.vscode/mcp.json', scope: 'project', format: 'json' }, ...USER_SETTINGS],
      keys: [
        'chat.tools.global.autoApprove',
        'chat.tools.terminal.autoApprove',
        'chat.tools.terminal.enableAutoApprove',
        'chat.tools.terminal.ignoreDefaultAutoApproveRules',
        'chat.tools.edits.autoApprove',
        'chat.tools.urls.autoApprove',
        'chat.tools.eligibleForAutoApproval',
        'chat.permissions.default',
        'chat.agent.sandbox.enabled',
        'chat.agent.sandbox.allowUnsandboxedCommands',
        'chat.tools.terminal.autoReplyToPrompts',
        'task.allowAutomaticTasks',
        'servers.*.sandboxEnabled',
      ],
      bypass: [
        { key: 'chat.tools.global.autoApprove', value: true },
        { key: 'chat.permissions.default', value: 'autoApprove' },
        { key: 'chat.permissions.default', value: 'autopilot' },
        { key: 'github.copilot.chat.claudeAgent.allowDangerouslySkipPermissions', value: true },
        { key: 'servers.*.sandboxEnabled', value: true },
        { key: 'task.allowAutomaticTasks', value: 'on' },
      ],
    },
    APPROVALS,
    `The keys and values are documented here and in ${AI_SETTINGS}, as flat setting names, not nested paths. Not settled: whether each works from .vscode/settings.json. Neither page states a scope, and the security page advises only against granting permissions at workspace level. Issue reports on microsoft/vscode conflict, so .vscode/settings.json is listed so that a scanner still looks there. The settings reference lists the values of chat.permissions.default as default, autoApprove and autopilot (Preview). chat.tools.edits.autoApprove appears in the settings reference, not on the approvals page. For Copilot harness sessions, terminal and URL approvals sync from user settings to the local Agent Host, and "Workspace settings are not copied"; Local harness sessions keep their approval options. Read again on 2026-11-12: in .vscode/mcp.json, "In Local harness sessions, editor-sandboxed MCP tools are auto-approved. This does not describe the Copilot harness's approval behavior" (${MCP_REFERENCE}); task.allowAutomaticTasks on runs automatic tasks "when opening a trusted workspace, without prompting", and the tasks page says to "add it to your user or workspace settings" (${TASKS}).`,
  ),
  autoRun: later.verified(
    {
      files: [{ path: '.vscode/tasks.json', scope: 'project', format: 'json' }],
      containerKey: 'tasks',
      triggerKey: 'runOptions.runOn',
      triggerValue: 'folderOpen',
      commandField: 'command',
    },
    TASKS,
    'The keys sit on each task. Whether a task starts is decided by task.allowAutomaticTasks: the default off does not run automatic tasks, and with no choice made for the workspace VS Code prompts once to Allow or Disallow; on runs them without prompting. Automatic tasks never run in an untrusted workspace, whatever the setting. The setting may be added to "user or workspace settings" (read on 2026-11-07), so a committed .vscode/settings.json can set it to on; permission-bypass reports that.',
  ),
  extensions: verified(
    {
      subagents: [
        { path: '.github/agents/*.md', scope: 'project', format: 'markdown-frontmatter' },
        { path: '.claude/agents/*.md', scope: 'project', format: 'markdown-frontmatter' },
        { path: '~/.copilot/agents/*.md', scope: 'user', format: 'markdown-frontmatter' },
        { path: '~/.claude/agents/*.md', scope: 'user', format: 'markdown-frontmatter' },
      ],
      commands: [{ path: '.github/prompts/*.prompt.md', scope: 'project', format: 'markdown-frontmatter' }],
    },
    AGENTS,
    `*.md covers the documented .agent.md and .md files. The Local harness keeps user agents in profile storage, and chat.agentFilesLocations adds directories. Commands are prompt files (${PROMPTS}): they run only in Local sessions, the Copilot harness does not load them (${MIGRATE}), and user prompt files live in the profile with no path given. chat.promptFilesLocations is deprecated.`,
  ),
};
