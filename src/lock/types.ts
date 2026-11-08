import type { ComponentKind } from '../inventory/types.ts';
import type { PackageRef } from '../rules/launch.ts';

export const LOCKFILE = 'agentcurfew.lock';
export const LOCKFILE_VERSION = 1;

export interface LockedServer {
  command: string | null;
  args: string[];
  urls: string[];
  /** Names only; values never enter the lock. */
  env: string[];
  headers: string[];
  package: PackageRef | null;
}

export interface LockedSkillFile {
  path: string;
  hash: string;
}

export interface LockedSkill {
  files: LockedSkillFile[];
  /** Programs, files with a shebang and scripts by extension: the same on every platform. */
  executables: string[];
  /** Files whose mode allows execution; Windows has no such bit, so it is not compared there. */
  executableBits: string[];
}

export interface LockedComponent {
  kind: ComponentKind;
  file: string;
  name: string;
  /** For people reading the lock; not part of the hash, since it follows the knowledge base and not the file. */
  agents: string[];
  hash: string;
  server?: LockedServer;
  skill?: LockedSkill;
  /** Files of the project that a hook, a task or a command setting runs, relative to the project; absent when none. */
  scripts?: LockedSkillFile[];
}

export interface Lockfile {
  lockfileVersion: number;
  algorithm: 'sha256';
  components: LockedComponent[];
}
