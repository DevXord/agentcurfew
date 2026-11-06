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
  /** The table of servers in this file, when it differs from McpKnowledge.serversKey. */
  serversKey?: string;
}

export interface McpKnowledge {
  files: readonly McpFile[];
  /** Dotted path to the table of servers inside a file, e.g. mcpServers. */
  serversKey: string;
  /** Field names of a server started locally; null when the agent has no local servers. */
  local: { command: string; args: string; env: string } | null;
  /** Field names of a remote server; null when the agent has no remote servers. */
  remote: { url: string; headers: string | null } | null;
}

export interface HooksKnowledge {
  files: readonly AgentPath[];
  /** Dotted path to the hooks inside the file; null when each file is a hook. */
  key: string | null;
  events: readonly string[];
  /** The kinds of handler, e.g. command. */
  handlerTypes: readonly string[];
  /** The field that holds the shell command of a command handler. */
  commandField: string | null;
}

export interface SkillsKnowledge {
  directories: readonly AgentPath[];
  /** The file that defines a skill inside its folder, e.g. SKILL.md. */
  entryFile: string;
}

export interface ContextFile extends AgentPath {
  /** always: read at the start of each session. conditional: read by path, glob, or at the model's choice. */
  loading: 'always' | 'conditional';
}

export interface PermissionsKnowledge {
  files: readonly AgentPath[];
  /** Keys in those files that grant or deny, dotted. */
  keys: readonly string[];
  /** Settings that turn prompts off, as written in those files; empty when they cannot be set from a file. */
  bypass: readonly { key: string; value: string | boolean }[];
}

/**
 * Work that starts with no user action. Where each is listed differs by agent: a mechanism of the agent's hooks may be
 * here or only among the hooks (Cursor's workspaceOpen); the note of the fact says which.
 */
export interface AutoRunKnowledge {
  files: readonly AgentPath[];
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

export interface SharedKnowledge {
  skillFormat: Fact<SkillFormatKnowledge>;
  skillsLock: Fact<SkillsLockKnowledge>;
}
