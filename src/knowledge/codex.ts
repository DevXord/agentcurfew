import { verifiedOn } from './define.ts';
import type { AgentKnowledge, AgentPath } from './types.ts';

const { verified, uncertain, disputed, evidence } = verifiedOn('2026-11-06');
// Facts changed after the source audit of 2026-11-07, read again that day.
const later = verifiedOn('2026-11-07');
const today = verifiedOn('2026-11-08');
// Read again in knowledge review W1 (2026-11-12).
const w1 = verifiedOn('2026-11-12');

const DOCS = 'https://learn.chatgpt.com/docs';
const CONFIG_BASIC = `${DOCS}/config-file/config-basic.md`;
const CONFIG_ADVANCED = `${DOCS}/config-file/config-advanced.md`;
const AGENTS_MD = `${DOCS}/agent-configuration/agents-md.md`;
const APPROVALS = `${DOCS}/agent-approvals-security.md`;
const SKILLS = `${DOCS}/build-skills.md`;
const HOOKS = `${DOCS}/hooks.md`;
const SUBAGENTS = `${DOCS}/agent-configuration/subagents.md`;

const SOURCE = 'https://github.com/openai/codex/blob/55897425e839d943a744c658701445ff732568a0/codex-rs';
const CONFIG_LOADER = `${SOURCE}/config/src/loader/mod.rs`;
const MCP_TYPES = `${SOURCE}/config/src/mcp_types.rs`;
const SKILL_ROOTS = `${SOURCE}/ext/skills/src/host_roots.rs`;
const STABLE = 'https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs';
const ALPHA = 'https://github.com/openai/codex/blob/rust-v0.170.0-alpha.2/codex-rs';

const PROJECT_CONFIG: AgentPath = { path: '**/.codex/config.toml', scope: 'project', format: 'toml' };
const USER_CONFIG: AgentPath = { path: '~/.codex/config.toml', scope: 'user', format: 'toml' };
const SYSTEM_CONFIG_UNIX: AgentPath = { path: '/etc/codex/config.toml', scope: 'managed', format: 'toml', platforms: ['linux', 'darwin'] };
const SYSTEM_CONFIG_WINDOWS: AgentPath = { path: '%ProgramData%/OpenAI/Codex/config.toml', scope: 'managed', format: 'toml', platforms: ['win32'] };

const HOME_NOTE = 'CODEX_HOME moves every ~/.codex path. Machine-wide paths are absolute, which the AgentPath comment does not cover.';

export const codex: AgentKnowledge = {
  id: 'codex',
  name: 'OpenAI Codex CLI',
  precedence: w1.verified(
    [PROJECT_CONFIG, { path: '~/.codex/*.config.toml', scope: 'user', format: 'toml' }, USER_CONFIG, SYSTEM_CONFIG_UNIX, SYSTEM_CONFIG_WINDOWS],
    CONFIG_BASIC,
    `Between CLI flags and the built-in defaults, the closest .codex/config.toml wins, then a --profile file (only when selected), the user file, cloud-managed defaults (no local file), then the system file. Project layers load only for trusted projects. requirements.toml constrains all of them. The Windows path is from ${CONFIG_LOADER}. ${HOME_NOTE} A project becomes trusted through projects."<path>".trust_level = "trusted" in the user config.toml (${DOCS}/config-file/config-reference.md), set by the onboarding prompt or /permissions (${APPROVALS}). Up to the stable 0.167.2, codex exec sends its working directory to the embedded app-server, and a thread/start with an explicit cwd saves trust for the project when the permission profile can write that folder (${STABLE}/app-server/src/request_processors/thread_processor.rs), so a writable exec run marks the project trusted. From 0.169.0-alpha.3 (on 2026-11-12 the newest is 0.170.0-alpha.2), codex exec gives that folder only as a default, keeps untrusted project configuration and MCP servers disabled with a warning, and saves trust only with --trust on codex exec or codex review (${ALPHA}/exec/src/cli.rs, ${ALPHA}/exec/src/lib.rs); the app-server rule stays for other clients. Read from code, not tested, and not described in the documentation (read on 2026-11-12).`,
  ),
  mcp: verified(
    {
      files: [PROJECT_CONFIG, USER_CONFIG, SYSTEM_CONFIG_UNIX, SYSTEM_CONFIG_WINDOWS],
      serversKey: 'mcp_servers',
      local: { command: 'command', args: 'args', env: 'env' },
      remote: { url: 'url', headers: 'http_headers' },
    },
    MCP_TYPES,
    `Project scoping (trusted projects only) is from ${DOCS}/extend/mcp.md. Other fields a scanner must read: env_vars, cwd, env_http_headers, bearer_token_env_var, and http_headers_helper, a command Codex runs to print headers. Plugins can also bundle MCP servers.`,
  ),
  hooks: later.verified(
    {
      files: [
        { path: '**/.codex/hooks.json', scope: 'project', format: 'json' },
        PROJECT_CONFIG,
        { path: '~/.codex/hooks.json', scope: 'user', format: 'json' },
        USER_CONFIG,
        { path: '/etc/codex/requirements.toml', scope: 'managed', format: 'toml', platforms: ['linux', 'darwin'] },
        { path: '%ProgramData%/OpenAI/Codex/requirements.toml', scope: 'managed', format: 'toml', platforms: ['win32'] },
      ],
      key: 'hooks',
      events: ['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreModelRequest', 'PostModelRequest', 'PreCompact', 'PostCompact', 'UserPromptSubmit', 'Stop', 'Interrupt'],
      handlerTypes: ['command', 'mcp_tool'],
      commandField: 'command',
    },
    HOOKS,
    `Hooks of all layers run together; a higher layer does not replace a lower one. Any active config layer can hold them, so these four files are the documented common ones, not the full list; plugins can bundle hooks too. commandWindows (command_windows in TOML) overrides the command on Windows. prompt and agent handlers are parsed but skipped. Non-managed hooks run only after review, tracked by hash. Separately, notify in config.toml runs a command; project config ignores it (${CONFIG_ADVANCED}). Managed hooks: "Define local Codex hooks under [hooks] in requirements.toml"; they are trusted by policy, and allow_managed_hooks_only = true skips all other sources (read on 2026-11-07).`,
  ),
  skills: disputed(
    'The documentation lists only .agents/skills roots, while the loader also scans .codex/skills next to each project config layer and the deprecated ~/.codex/skills. Scan every path of both variants. Codex follows symlinked skill folders.',
    w1.evidence(
      {
        directories: [
          { path: '**/.agents/skills', scope: 'project', format: 'markdown-frontmatter' },
          { path: '~/.agents/skills', scope: 'user', format: 'markdown-frontmatter' },
          { path: '/etc/codex/skills', scope: 'managed', format: 'markdown-frontmatter', platforms: ['linux', 'darwin'] },
        ],
        entryFile: 'SKILL.md',
      },
      SKILLS,
      'Repository roots run from the working directory up to the repository root.',
    ),
    w1.evidence(
      {
        directories: [
          { path: '**/.agents/skills', scope: 'project', format: 'markdown-frontmatter' },
          { path: '**/.codex/skills', scope: 'project', format: 'markdown-frontmatter' },
          { path: '~/.agents/skills', scope: 'user', format: 'markdown-frontmatter' },
          { path: '~/.codex/skills', scope: 'user', format: 'markdown-frontmatter' },
          { path: '/etc/codex/skills', scope: 'managed', format: 'markdown-frontmatter', platforms: ['linux', 'darwin'] },
          { path: '%ProgramData%/OpenAI/Codex/skills', scope: 'managed', format: 'markdown-frontmatter', platforms: ['win32'] },
        ],
        entryFile: 'SKILL.md',
      },
      SKILL_ROOTS,
      'The Windows path follows from the system config folder in the config loader; ~/.codex/skills is marked deprecated in the code.',
    ),
  ),
  contextFiles: verified(
    [
      { path: '~/.codex/AGENTS.override.md', scope: 'user', format: 'markdown', loading: 'always' },
      { path: '~/.codex/AGENTS.md', scope: 'user', format: 'markdown', loading: 'always' },
      { path: '**/AGENTS.override.md', scope: 'project', format: 'markdown', loading: 'always' },
      { path: '**/AGENTS.md', scope: 'project', format: 'markdown', loading: 'always' },
    ],
    AGENTS_MD,
    'Read at startup, once per run, for each directory from the project root down to the working directory, so a file outside that path is not read in that run. One file per directory, override first. project_doc_fallback_filenames adds other names, so the list is open-ended and config.toml must be read to find them. project_doc_max_bytes caps the total, 32 KiB by default.',
  ),
  permissions: later.verified(
    {
      files: [
        PROJECT_CONFIG,
        USER_CONFIG,
        { path: '**/.codex/rules/*.rules', scope: 'project', format: 'text' },
        { path: '~/.codex/rules/*.rules', scope: 'user', format: 'text' },
        { path: '/etc/codex/requirements.toml', scope: 'managed', format: 'toml', platforms: ['linux', 'darwin'] },
        { path: '%ProgramData%/OpenAI/Codex/requirements.toml', scope: 'managed', format: 'toml', platforms: ['win32'] },
      ],
      keys: ['approval_policy', 'sandbox_mode', 'default_permissions', 'permissions', 'sandbox_workspace_write.network_access', 'sandbox_workspace_write.writable_roots', 'mcp_servers.<id>.default_tools_approval_mode', 'mcp_servers.<id>.tools.<tool>.approval_mode', 'apps.<id>.default_tools_approval_mode', 'apps.<id>.tools.<tool>.approval_mode', 'approvals_reviewer', 'apps.<id>.approvals_reviewer'],
      bypass: [
        { key: 'approval_policy', value: 'never', fromProject: 'needs-trust' },
        { key: 'sandbox_mode', value: 'danger-full-access', fromProject: 'needs-trust' },
        { key: 'default_permissions', value: ':danger-full-access', fromProject: 'needs-trust' },
      ],
    },
    APPROVALS,
    `.rules files are Starlark, with prefix_rule decisions of allow, prompt or forbidden (${DOCS}/agent-configuration/rules.md). The :danger-full-access built-in is from ${DOCS}/permissions.md. None of the bypass keys is on PROJECT_LOCAL_CONFIG_DENYLIST in ${CONFIG_LOADER}, so a trusted project file appears able to set them; this is read from the code and was not tested by running Codex. Read on 2026-11-07 (${DOCS}/config-file/config-reference.md): approval_policy is on-request, never or a granular table; "untrusted is unsupported, and on-failure is deprecated", so a file with either no longer asks as it used to. App tools take approval_mode auto, prompt, writes or approve, and approvals_reviewer auto_review hands eligible prompts to a reviewer subagent; whether approve skips the prompt is not stated, so they are listed as keys, not as bypasses.`,
  ),
  autoRun: later.verified(
    {
      files: [{ path: '**/.codex/hooks.json', scope: 'project', format: 'json' }, PROJECT_CONFIG, { path: '~/.codex/hooks.json', scope: 'user', format: 'json' }, USER_CONFIG],
      triggerKey: 'hooks.SessionStart',
      triggerValue: 'any',
      commandField: 'command',
    },
    HOOKS,
    'No page describes a command that starts when a folder is opened. The closest is a SessionStart hook, which runs "when a session or subagent starts" with no action by the user, as Claude Code and Gemini CLI hooks of that event are counted too; any handler under the key counts. Non-managed hooks run only after review, and project layers only for trusted projects. stdio MCP servers also start with a session; the mcp fact covers them.',
  ),
  extensions: verified(
    {
      subagents: [
        { path: '.codex/agents/*.toml', scope: 'project', format: 'toml' },
        { path: '~/.codex/agents/*.toml', scope: 'user', format: 'toml' },
      ],
      commands: [{ path: '~/.codex/prompts/*.md', scope: 'user', format: 'markdown-frontmatter' }],
    },
    SUBAGENTS,
    `Custom prompts are deprecated in favour of skills and live only in the user folder, top level only (${DOCS}/custom-prompts.md). Custom agents can also be named through agents.<name>.config_file in config.toml.`,
  ),
  deprecations: [
    verified({ paths: ['~/.codex/prompts/*.md'], replacement: 'skills' }, `${DOCS}/custom-prompts.md`, 'Custom prompts are deprecated in favour of skills.'),
    uncertain({ paths: ['~/.codex/skills'], replacement: '~/.agents/skills' }, SKILL_ROOTS, 'Marked deprecated in the code; the documentation names only the .agents/skills roots.'),
  ],
  commands: today.verified(
    { files: [PROJECT_CONFIG, USER_CONFIG], settings: [{ key: 'notify', runs: 'on-demand', fromProject: 'ignored' }] },
    `${CONFIG_ADVANCED}#notifications`,
    `notify is a list of words, the program and its arguments, run "whenever Codex emits supported events (currently only agent-turn-complete)". Codex "ignores the following keys in project-local .codex/config.toml and prints a startup warning when it sees them", notify among them (${CONFIG_ADVANCED}); the same list is PROJECT_LOCAL_CONFIG_DENYLIST in ${CONFIG_LOADER}. MCP servers' http_headers_helper is a command too; the mcp fact notes it.`,
  ),
};
