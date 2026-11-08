import type { LockedComponent, Lockfile } from './types.ts';

export interface Change {
  type: 'added' | 'removed' | 'changed';
  kind: LockedComponent['kind'];
  file: string;
  name: string;
  /** What changed, in words; carries only paths, names and redacted command-line words. */
  details: string[];
}

const key = (component: LockedComponent) => `${component.kind}\0${component.file}\0${component.name}`;

function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function listDiff(what: string, before: readonly string[], after: readonly string[]): string[] {
  const added = after.filter((item) => !before.includes(item));
  const removed = before.filter((item) => !after.includes(item));
  return [...added.map((item) => `${what} added: ${item}`), ...removed.map((item) => `${what} removed: ${item}`)];
}

function scriptDiff(before: readonly { path: string; hash: string }[], after: readonly { path: string; hash: string }[]): string[] {
  const lines: string[] = [];
  const old = new Map(before.map((file) => [file.path, file.hash]));
  const now = new Map(after.map((file) => [file.path, file.hash]));
  for (const [path, hash] of now) {
    if (!old.has(path)) lines.push(`script added: ${path}`);
    else if (old.get(path) !== hash) lines.push(`script changed: ${path}`);
  }
  for (const path of old.keys()) if (!now.has(path)) lines.push(`script removed: ${path}`);
  return lines;
}

function details(before: LockedComponent, after: LockedComponent, compareBits: boolean): string[] {
  const lines: string[] = [];
  if (before.skill !== undefined && after.skill !== undefined) {
    const old = new Map(before.skill.files.map((file) => [file.path, file.hash]));
    const now = new Map(after.skill.files.map((file) => [file.path, file.hash]));
    for (const [path, hash] of now) {
      if (!old.has(path)) lines.push(`file added: ${path}`);
      else if (old.get(path) !== hash) lines.push(`file changed: ${path}`);
    }
    for (const path of old.keys()) if (!now.has(path)) lines.push(`file removed: ${path}`);
    lines.push(...listDiff('executable', before.skill.executables, after.skill.executables));
    if (compareBits) lines.push(...listDiff('executable bit', before.skill.executableBits, after.skill.executableBits));
    return lines;
  }
  if (before.server !== undefined && after.server !== undefined) {
    const a = before.server;
    const b = after.server;
    if (a.command !== b.command) lines.push(`command: ${a.command ?? '(none)'} -> ${b.command ?? '(none)'}`);
    if (JSON.stringify(a.args) !== JSON.stringify(b.args)) lines.push(`args: ${JSON.stringify(a.args)} -> ${JSON.stringify(b.args)}`);
    if (JSON.stringify(a.urls) !== JSON.stringify(b.urls)) lines.push(`address: ${a.urls.join(' ') || '(none)'} -> ${b.urls.join(' ') || '(none)'}`);
    lines.push(...listDiff('environment variable', a.env, b.env), ...listDiff('header', a.headers, b.headers));
    if (lines.length === 0 && before.hash !== after.hash) lines.push('another field changed, such as a setting or the name of a variable');
    return lines;
  }
  return [...(before.hash === after.hash ? [] : ['the content changed']), ...scriptDiff(before.scripts ?? [], after.scripts ?? [])];
}

/**
 * What differs between a lock and the current state. Execute bits are compared only when both sides could see them,
 * which is not the case on Windows.
 */
export function diffLocks(locked: Lockfile, current: Lockfile, options: { compareExecutableBits?: boolean } = {}): Change[] {
  const compareBits = options.compareExecutableBits ?? process.platform !== 'win32';
  const before = new Map(locked.components.map((component) => [key(component), component]));
  const after = new Map(current.components.map((component) => [key(component), component]));
  const changes: Change[] = [];
  for (const [id, now] of after) {
    const old = before.get(id);
    if (old === undefined) {
      changes.push({ type: 'added', kind: now.kind, file: now.file, name: now.name, details: [] });
      continue;
    }
    const found = old.hash !== now.hash || old.skill !== undefined || old.server !== undefined || old.scripts !== undefined || now.scripts !== undefined ? details(old, now, compareBits) : [];
    if (found.length > 0) changes.push({ type: 'changed', kind: now.kind, file: now.file, name: now.name, details: found });
  }
  for (const [id, old] of before) if (!after.has(id)) changes.push({ type: 'removed', kind: old.kind, file: old.file, name: old.name, details: [] });
  return changes.sort((a, b) => compare(a.file, b.file) || compare(a.kind, b.kind) || compare(a.name, b.name));
}

/** On Windows the execute bits cannot be seen, so a new lock keeps those of the old one for files still there. */
export function carryExecutableBits(next: Lockfile, previous: Lockfile | undefined): Lockfile {
  if (previous === undefined) return next;
  const old = new Map(previous.components.map((component) => [key(component), component]));
  return {
    ...next,
    components: next.components.map((component) => {
      const before = old.get(key(component))?.skill;
      if (component.skill === undefined || before === undefined) return component;
      const paths = new Set(component.skill.files.map((file) => file.path));
      return { ...component, skill: { ...component.skill, executableBits: before.executableBits.filter((path) => paths.has(path)) } };
    }),
  };
}
