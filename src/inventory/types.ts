import type { AgentId, Scope } from '../knowledge/types.ts';

export type ComponentKind = 'skill' | 'mcp-server' | 'hook' | 'auto-run' | 'context-file' | 'permission' | 'subagent' | 'command' | 'command-setting' | 'setting';

/** Every kind, in the order of the type; a lock of a later version may hold others, which are skipped (D-045). */
export const COMPONENT_KINDS: readonly ComponentKind[] = ['skill', 'mcp-server', 'hook', 'auto-run', 'context-file', 'permission', 'subagent', 'command', 'command-setting', 'setting'];

export type SkillFileType = 'text' | 'executable' | 'media' | 'binary';

export interface SkillFile {
  /** Relative to the skill folder, or to the project for a script a command runs (filesRoot project); / separators. */
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
  /** Unique within kind and file. For a hook it is its position (PreToolUse#0), so it shifts when one is added before it. */
  name: string;
  /**
   * Stable within kind and file (D-042): the name where the name is stable already, a hook's event, matcher and a hash
   * of its handler, an unnamed task's hash. The same for the hook and auto-run copies of one entry. The scanner always
   * sets it; a component built by hand without it counts as having its name for id (idOf).
   */
  id?: string;
  /** The text of the file or the JSON of the entry. May hold secrets, so it must not reach the output as it is. */
  raw: string;
  /** A skill's files, sorted; or the scripts of the project that a hook, a task or a command setting runs. */
  files?: readonly SkillFile[];
  /** project: the paths of files are relative to the project, not to the component's folder. */
  filesRoot?: 'project';
  /**
   * Whether raw is the text of the whole file rather than one entry of it. The scanner always sets it; a component built
   * by hand without it is judged by its name (text.ts isWholeFile). Kept out of the output.
   */
  whole?: boolean;
}

/** A component's id, or its name when it was built without one. */
export function idOf(component: { id?: string; name: string }): string {
  return component.id ?? component.name;
}

export type ProblemCode = 'outside-project' | 'too-large' | 'too-deep' | 'too-many-entries' | 'unreadable' | 'unparsable';

/**
 * Problems that leave a file of the knowledge base unchecked, so that `scan` fails on them (Q-013, decision of the
 * maintainer): a hostile repository could otherwise pad a file, or the tree before it, until it is skipped.
 * too-many-entries counts too, since padding a folder past the entry limit leaves the files after it unread (found by the
 * pentest of 2026-11-07), and too-deep includes configuration nested deeper than agentcurfew parses, which an agent may
 * still load. unparsable and outside-project stay warnings: the agent cannot load the first either, and the second is a
 * link the scanner refuses on purpose.
 */
export const UNCHECKED_PROBLEMS: readonly ProblemCode[] = ['too-large', 'too-deep', 'too-many-entries', 'unreadable'];

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
  /** Bytes read in one scan, all files together; past it a file is reported as too-large and not read. 128 MB when not given. */
  maxTotalBytes?: number;
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
