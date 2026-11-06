import type { AgentId, Scope } from '../knowledge/types.ts';

export type ComponentKind = 'skill' | 'mcp-server' | 'hook' | 'auto-run' | 'context-file' | 'permission' | 'subagent' | 'command';

export type SkillFileType = 'text' | 'executable' | 'media' | 'binary';

export interface SkillFile {
  /** Relative to the skill folder, with / separators. */
  path: string;
  bytes: number;
  /** What the first bytes show; absent when the file could not be read. Kept out of the output, like raw. */
  type?: SkillFileType;
  /** The text of a text file, for the rules. Kept out of the output. */
  raw?: string;
  /** The bytes as read, for checksums. Kept out of the output. */
  content?: Buffer;
  /** Reached through a link, the file's own or a folder's. */
  link?: boolean;
  /** The mode allows execution; never set on Windows. */
  executableBit?: boolean;
}

export interface Component {
  kind: ComponentKind;
  /** Every agent that reads it, sorted. */
  agents: readonly AgentId[];
  scope: Scope;
  /** Relative to the project, or starting with ~/ or a variable; never the user's real home path. */
  file: string;
  /** Unique within kind and file. */
  name: string;
  /** The text of the file or the JSON of the entry. May hold secrets, so it must not reach the output as it is. */
  raw: string;
  /** Skills only: every file of the folder, sorted. */
  files?: readonly SkillFile[];
}

export type ProblemCode = 'outside-project' | 'too-large' | 'too-deep' | 'too-many-entries' | 'unreadable' | 'unparsable';

/** A place the scanner could not fully inventory. It carries no text from the file, which may be hostile or secret. */
export interface InventoryProblem {
  code: ProblemCode;
  file: string;
}

export interface Inventory {
  components: readonly Component[];
  problems: readonly InventoryProblem[];
}

export interface Limits {
  maxFileBytes: number;
  maxDepth: number;
  /** Directory entries looked at in one scan. */
  maxEntries: number;
}

export interface ScanOptions {
  root: string;
  /** Also read the user's and the machine's configuration. */
  user?: boolean;
  home?: string;
  env?: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform;
  limits?: Partial<Limits>;
  /**
   * Files read as if they held this text, by path relative to the project with / separators; a path that does not exist
   * yet is seen as a new file. The hook checks a write this way before it happens. Nothing is written to disk.
   */
  overlay?: ReadonlyMap<string, string>;
}
