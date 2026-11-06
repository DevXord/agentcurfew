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
  remote: { url: string; headers: string | null; /** Further fields that hold the address in other transports. */ otherUrls?: readonly string[] } | null;
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
  /** Matches the value itself, or an item of a list. */
  value: string | boolean;
  /**
   * What the agent does with it in a project file: ignored (only user or managed files count), needs-trust (only once
   * the folder is trusted). Absent when the source says nothing more.
   */
  fromProject?: 'ignored' | 'needs-trust';
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
