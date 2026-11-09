// Every fact about an agent carries the official URL it was verified against and the date of verification.
// Disputed facts keep every variant with its own source. A value of null means the agent is known not to have the feature.

export type AgentId = 'claude-code' | 'cursor' | 'codex' | 'gemini-cli' | 'copilot-vscode' | 'windsurf' | 'cline';

export interface Evidence<T> {
  value: T;
  /** URL of official documentation or source code. */
  source: string;
  /** YYYY-MM-DD */
  verifiedAt: string;
  note?: string;
}

export interface VerifiedFact<T> extends Evidence<T> {
  status: 'verified';
}

/** Supported by an official source, but not conclusively: inferred from code or from the absence of an option. */
export interface UncertainFact<T> extends Evidence<T> {
  status: 'uncertain';
  note: string;
}

/** Official sources disagree; every variant is kept. */
export interface DisputedFact<T> {
  status: 'disputed';
  note: string;
  variants: readonly [Evidence<T>, Evidence<T>, ...Evidence<T>[]];
}

export type Fact<T> = VerifiedFact<T> | UncertainFact<T> | DisputedFact<T>;

/** project: lives in the repository. user: lives in the home directory. managed: placed by an administrator. */
export type Scope = 'project' | 'user' | 'managed';

export type FileFormat = 'json' | 'jsonc' | 'toml' | 'yaml' | 'markdown' | 'markdown-frontmatter' | 'text';

/** A file or directory an agent reads. */
export interface AgentPath {
  /**
   * With / separators, and may hold * and **. Project paths are relative to the project root. User paths start with ~/
   * or with a variable as the agent's docs write it (%APPDATA%/...). Managed paths are absolute, or start with such a variable.
   */
  path: string;
  scope: Scope;
  format: FileFormat;
  /** Present when the location differs by platform. */
  platforms?: readonly ('linux' | 'darwin' | 'win32')[];
}

export interface McpFile extends AgentPath {
  /**
   * The table of servers in this file, when it differs from McpKnowledge.serversKey. A segment <project> stands for the
   * key that names the scanned project by its absolute path.
   */
  serversKey?: string;
}

export interface McpKnowledge {
  files: readonly McpFile[];
  /** Dotted path to the table of servers inside a file, e.g. mcpServers. */
  serversKey: string;
  /** Field names of a server started locally; null when the agent has no local servers. */
  local: { command: string; args: string; env: string } | null;
  /** Field names of a remote server; null when the agent has no remote servers. */
  remote: {
    url: string;
    headers: string | null;
    /** Further fields that hold the address in other transports. */
    otherUrls?: readonly string[];
    /** The field with a command the agent runs when connecting, to print headers; absent when the agent has none. */
    headersHelper?: string;
  } | null;
}

export interface HookFile extends AgentPath {
  /** The hooks in this file, when it differs from HooksKnowledge.key; null when they are the whole file. */
  key?: string | null;
}

export interface HooksKnowledge {
  files: readonly HookFile[];
  /** Dotted path to the hooks inside the file; null when each file is a hook. */
  key: string | null;
  events: readonly string[];
  /** The kinds of handler, e.g. command. */
  handlerTypes: readonly string[];
  /** The field that holds the shell command of a command handler. */
  commandField: string | null;
  /** Events that fire with no action by the user or the agent, such as opening a workspace; their hooks are also auto-run. */
  autoStartEvents?: readonly string[];
}

export interface SkillsKnowledge {
  directories: readonly AgentPath[];
  /** The file that defines a skill inside its folder, e.g. SKILL.md. */
  entryFile: string;
  /** The frontmatter field that grants tools without a prompt, read with the agent's allowAllShell entries. */
  grantsField?: string;
}

export interface ContextFile extends AgentPath {
  /** always: read at the start of each session. conditional: read by path, glob, or at the model's choice. */
  loading: 'always' | 'conditional';
}

export interface BypassSetting {
  key: string;
  /** Matches the value itself, or an item of a list; '*' matches any non-empty string or list, as in a list of approved servers. */
  value: string | boolean;
  /**
   * What the agent does with it in a project file: ignored (only user or managed files count), needs-trust (only once
   * the folder is trusted). Absent when the source says nothing more.
   */
  fromProject?: 'ignored' | 'needs-trust';
  /** What it approves, when that is less than every prompt, such as file edits; reported at medium instead of high. */
  approves?: string;
}

export interface PermissionsKnowledge {
  files: readonly AgentPath[];
  /** Keys in those files that grant or deny, dotted. */
  keys: readonly string[];
  /** Settings that turn prompts off, as written in those files; empty when they cannot be set from a file. */
  bypass: readonly BypassSetting[];
  /** Entries of a list under `key` that allow every shell command at once, e.g. Bash in permissions.allow. */
  allowAllShell?: readonly { key: string; value: string }[];
}

/**
 * Work that starts with no user action. Where each is listed differs by agent: a mechanism of the agent's hooks may be
 * here or only among the hooks (Cursor's workspaceOpen); the note of the fact says which.
 */
export interface AutoRunKnowledge {
  files: readonly AgentPath[];
  /** Dotted path to a list of entries, each with its own trigger (tasks in tasks.json); absent when each file is one. */
  containerKey?: string;
  /** Dotted path to the field that makes it start on its own. */
  triggerKey: string;
  /** The value that does; 'any' when the key being set is enough. */
  triggerValue: string;
  /** The field that holds what runs: a shell command, or a prompt for the agent (Cline's scheduled files). */
  commandField: string;
}

export interface ExtensionsKnowledge {
  subagents: readonly AgentPath[];
  commands: readonly AgentPath[];
}

/** A file or setting the agent still reads, or used to, that its source calls legacy or deprecated. */
export interface Deprecation {
  /** Files, as AgentPath writes them: the old file itself, or the files that hold the old key. */
  paths: readonly string[];
  /** A dotted key inside those files; absent when the file itself is what is old. */
  key?: string;
  replacement: string;
}

/** A setting outside the hooks whose value is a command the agent runs, such as a status line or a credential helper. */
export interface CommandSetting {
  /** Dotted key in the settings file. */
  key: string;
  /** The field of the setting's object that holds the command; absent when the value itself is the command (a string or a list of words). */
  commandField?: string;
  /** session-start: runs when a session starts, before the first prompt. on-demand: runs when the agent needs it. */
  runs: 'session-start' | 'on-demand';
  /** As in BypassSetting: ignored (only user or managed files count), needs-trust. Absent when a project file can set it. */
  fromProject?: 'ignored' | 'needs-trust';
}

export interface CommandSettingsKnowledge {
  files: readonly AgentPath[];
  settings: readonly CommandSetting[];
}

/**
 * A variable of the settings' env block that changes where the agent sends its requests or how it runs commands.
 * endpoint: the address of the model API or of telemetry. proxy: every connection goes through it. headers: added to
 * every API request. command-wrapper: a command that wraps the commands the agent runs.
 */
export interface EnvVariable {
  name: string;
  effect: 'endpoint' | 'proxy' | 'headers' | 'command-wrapper';
  /** As in BypassSetting; absent when a project file can set it. */
  fromProject?: 'ignored' | 'needs-trust';
}

/** Environment variables set from settings files for every session and the processes it starts. */
export interface EnvKnowledge {
  files: readonly AgentPath[];
  /** Dotted key of the object of variables, e.g. env. */
  key: string;
  /** The variables that matter for security; every variable of the block is inventoried. */
  variables: readonly EnvVariable[];
}

/** A source type of a plugin marketplace registered in settings. */
export interface MarketplaceSource {
  /** The value of source.source, e.g. github. */
  type: string;
  /** remote: fetched from the network. local: a path on the machine. inline: declared in the settings file. */
  where: 'remote' | 'local' | 'inline';
  /** The field of the source with an address, when it has one. */
  urlField?: string;
  /** The field of the source with a command the agent runs before it fetches, when it has one. */
  headersHelper?: string;
}

/** Plugins enabled and marketplaces registered in settings files. */
export interface PluginsKnowledge {
  files: readonly AgentPath[];
  /** Dotted key of the object that turns plugins on or off, keyed plugin@marketplace. */
  enabledKey: string;
  /** Dotted keys of the object of marketplaces by name; the first is the documented one, the others aliases. */
  marketplacesKeys: readonly string[];
  /** What the agent does with a marketplace from a project file. */
  marketplacesFromProject?: 'ignored' | 'needs-trust';
  sources: readonly MarketplaceSource[];
  /** The field of a marketplace entry that updates its plugins on its own. */
  autoUpdateField: string;
}

/** A setting that names further context files, read where the default one would be. */
export interface ContextNamesKnowledge {
  files: readonly AgentPath[];
  /** Dotted key; its value is a string or a list of strings. */
  key: string;
  /** Whether the names replace the default context file, or come in addition to it. */
  replacesDefault: boolean;
  /** Where a configured name is looked for, with <name> standing for it. */
  locations: readonly ContextFile[];
}

/** A setting that turns the hooks of the user and the project off at once. */
export interface HooksOffKnowledge {
  files: readonly AgentPath[];
  /** Dotted key; true turns the hooks off. */
  key: string;
}

/** A hook that runs before a tool and can allow, deny or ask: what it reads on stdin and how it answers. */
export interface ToolHookKnowledge {
  /** The event, e.g. PreToolUse, and where its handlers sit in the settings, as a dotted key. */
  event: string;
  settingsKey: string;
  /** The field of the stdin JSON with the tool's name, and the one with its input. */
  toolNameField: string;
  toolInputField: string;
  /** Tools by name, with the fields of their input that matter. */
  tools: Readonly<Record<string, { command?: string; path?: string; content?: string; oldText?: string; newText?: string; replaceAll?: string }>>;
  /** Where the answer goes in the stdout JSON, dotted, the field with the reason, and the one that names the event. */
  decisionField: string;
  eventNameField: string;
  reasonField: string;
  /** Every decision, from the one that wins over the others to the one that loses. */
  decisions: readonly string[];
  /** The variable that holds the project root in a hook command. */
  projectDirVariable: string;
  /** Tools that write files but whose input fields the docs do not show; a hook matches them and asks by the file named. */
  otherWriteTools?: readonly string[];
}

/** A command of the agent's own CLI that adds an MCP server. */
export interface McpAddKnowledge {
  /** The words that start it, e.g. ["claude", "mcp", "add"]. */
  command: readonly string[];
  /** The same with a JSON definition, e.g. ["claude", "mcp", "add-json"]. */
  jsonCommand: readonly string[];
  /** The word after which the server's own command line starts. */
  separator: string;
  /** Options that take a value, so that the value is not taken for the name. */
  valueOptions: readonly string[];
}

export interface AgentKnowledge {
  id: AgentId;
  name: string;
  /** Configuration files of the agent, from the one that wins to the one that loses. */
  precedence: Fact<readonly AgentPath[]>;
  mcp: Fact<McpKnowledge | null>;
  hooks: Fact<HooksKnowledge | null>;
  skills: Fact<SkillsKnowledge | null>;
  contextFiles: Fact<readonly ContextFile[]>;
  permissions: Fact<PermissionsKnowledge | null>;
  autoRun: Fact<AutoRunKnowledge | null>;
  extensions: Fact<ExtensionsKnowledge | null>;
  /** A hook before each tool call that can block it; absent when the agent has none or it is not researched. */
  toolHook?: Fact<ToolHookKnowledge>;
  mcpAdd?: Fact<McpAddKnowledge>;
  /** Settings that run a command outside the hooks; absent when not researched for the agent. */
  commands?: Fact<CommandSettingsKnowledge>;
  /** Environment variables from settings files; absent when not researched for the agent. */
  env?: Fact<EnvKnowledge>;
  /** Plugins and marketplaces in settings files; absent when not researched for the agent. */
  plugins?: Fact<PluginsKnowledge>;
  /** Variables that hold the project root in a hook's command, besides toolHook's; absent when not researched. */
  hookProjectDir?: Fact<readonly string[]>;
  /** A setting that turns hooks off; absent when the agent has none or it is not researched. */
  hooksOff?: Fact<HooksOffKnowledge>;
  /** A setting that adds or renames context files; absent when the agent has none or it is not researched. */
  contextNames?: Fact<ContextNamesKnowledge>;
  /** One fact per deprecation, each with its own source; absent when none is known. */
  deprecations?: readonly Fact<Deprecation>[];
}

/** The Agent Skills format, shared by several agents. */
export interface SkillFormatKnowledge {
  entryFile: string;
  requiredFields: readonly string[];
  optionalFields: readonly string[];
  /** Folders of a skill that hold bundled files. */
  bundledDirectories: readonly string[];
}

/** skills-lock.json of the Vercel skills installer. */
export interface SkillsLockKnowledge {
  file: string;
  versionField: string;
  skillsField: string;
  /** Fields of one entry. */
  entryFields: readonly string[];
  hashField: string;
  /** The algorithm and how the folder is walked, in words precise enough to reproduce it. */
  hashAlgorithm: string;
}

/** The add command of the Vercel skills installer. */
export interface SkillsInstallerKnowledge {
  /** The package run by a launcher, and its subcommand: npx skills add <source>. */
  packageName: string;
  addCommand: string;
  /** Options that take a value. */
  valueOptions: readonly string[];
}

export interface SharedKnowledge {
  skillFormat: Fact<SkillFormatKnowledge>;
  skillsLock: Fact<SkillsLockKnowledge>;
  skillsInstaller: Fact<SkillsInstallerKnowledge>;
}
