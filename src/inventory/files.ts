import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { InventoryProblem, Limits, ProblemCode } from './types.ts';

export const DEFAULT_LIMITS: Limits = { maxFileBytes: 2 * 1024 * 1024, maxDepth: 32, maxEntries: 200_000 };

const SKIPPED_IN_SEARCH = new Set(['node_modules', '.git']);

/** A directory tree the scanner may read: links that leave `base` are not followed. */
export interface Area {
  base: string;
  /** What stands for `base` in reported paths: '' for the project, ~ for the home directory. */
  label: string;
}

export interface Found {
  path: string;
  /** The path as reported. */
  file: string;
  area: Area;
}

type Kind = 'file' | 'directory';

export interface TreeFile {
  found: Found;
  relative: string;
  bytes: number;
  link: boolean;
  executable: boolean;
}

function joinLabel(label: string, name: string): string {
  return label === '' ? name : `${label}/${name}`;
}

function globPattern(segment: string): RegExp {
  const source = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*');
  return new RegExp(`^${source}$`);
}

export class ScanFiles {
  readonly #limits: Limits;
  readonly #problems = new Map<string, InventoryProblem>();
  readonly #listings = new Map<string, readonly string[]>();
  #entries = 0;

  constructor(limits: Limits) {
    this.#limits = limits;
  }

  get problems(): readonly InventoryProblem[] {
    return [...this.#problems.values()];
  }

  report(code: ProblemCode, file: string): void {
    this.#problems.set(`${code}\0${file}`, { code, file });
  }

  #list(path: string, file: string): readonly string[] {
    const cached = this.#listings.get(path);
    if (cached !== undefined) return cached;
    let names: string[] = [];
    try {
      names = readdirSync(path).sort();
    } catch {
      this.report('unreadable', file === '' ? '.' : file);
    }
    const room = this.#limits.maxEntries - this.#entries;
    if (names.length > room) {
      this.report('too-many-entries', file === '' ? '.' : file);
      names = names.slice(0, Math.max(room, 0));
    }
    this.#entries += names.length;
    this.#listings.set(path, names);
    return names;
  }

  /** What is at a path, seen through a link only when it stays inside the area. */
  #kind(area: Area, path: string, file: string): { kind: Kind; real: string; bytes: number; link: boolean; executable: boolean } | undefined {
    try {
      const link = lstatSync(path);
      if (!link.isSymbolicLink()) {
        if (link.isFile()) return { kind: 'file', real: path, bytes: link.size, link: false, executable: (link.mode & 0o111) !== 0 };
        if (link.isDirectory()) return { kind: 'directory', real: path, bytes: 0, link: false, executable: false };
        return undefined;
      }
      const real = realpathSync.native(path);
      if (real !== area.base && !real.startsWith(area.base + sep)) {
        this.report('outside-project', file);
        return undefined;
      }
      const target = statSync(real);
      if (target.isFile()) return { kind: 'file', real, bytes: target.size, link: true, executable: (target.mode & 0o111) !== 0 };
      if (target.isDirectory()) return { kind: 'directory', real, bytes: 0, link: true, executable: false };
      return undefined;
    } catch {
      return undefined;
    }
  }

  /** Every file and directory that a pattern of /-separated segments names below `dir`. */
  match(area: Area, segments: readonly string[], directories: boolean): Found[] {
    const found: Found[] = [];
    const seen = new Set<string>([area.base]);
    const visit = (dir: string, label: string, rest: readonly string[], depth: number): void => {
      if (depth > this.#limits.maxDepth) {
        this.report('too-deep', label);
        return;
      }
      const [segment, ...after] = rest;
      if (segment === undefined) return;
      if (segment === '**') {
        visit(dir, label, after, depth);
        for (const name of this.#list(dir, label)) {
          if (SKIPPED_IN_SEARCH.has(name)) continue;
          const path = join(dir, name);
          const file = joinLabel(label, name);
          const entry = this.#kind(area, path, file);
          if (entry?.kind !== 'directory' || seen.has(entry.real)) continue;
          seen.add(entry.real);
          visit(path, file, rest, depth + 1);
        }
        return;
      }
      const names = segment.includes('*') ? this.#list(dir, label).filter((name) => globPattern(segment).test(name)) : [segment];
      for (const name of names) {
        const path = join(dir, name);
        const file = joinLabel(label, name);
        const entry = this.#kind(area, path, file);
        if (entry === undefined) continue;
        if (after.length > 0) {
          if (entry.kind === 'directory') visit(path, file, after, depth + 1);
        } else if (entry.kind === 'file' || directories) {
          found.push({ path, file, area });
        }
      }
    };
    visit(area.base, area.label, segments, 0);
    return found;
  }

  isDirectory(found: Found): boolean {
    return this.#kind(found.area, found.path, found.file)?.kind === 'directory';
  }

  /**
   * Every file below a directory, with paths relative to it, sizes, whether a link was crossed to reach it (the file or a
   * folder above it) and whether its mode allows execution (always false on Windows, which has no such bit).
   */
  tree(found: Found): TreeFile[] {
    const files: TreeFile[] = [];
    const seen = new Set<string>();
    const visit = (dir: string, label: string, relative: string, depth: number, linked = false): void => {
      if (depth > this.#limits.maxDepth) {
        this.report('too-deep', label);
        return;
      }
      for (const name of this.#list(dir, label)) {
        const path = join(dir, name);
        const file = joinLabel(label, name);
        const entry = this.#kind(found.area, path, file);
        if (entry === undefined) continue;
        const inner = relative === '' ? name : `${relative}/${name}`;
        if (entry.kind === 'file') {
          files.push({ found: { path, file, area: found.area }, relative: inner, bytes: entry.bytes, link: linked || entry.link, executable: entry.executable });
        } else if (!seen.has(entry.real)) {
          seen.add(entry.real);
          visit(path, file, inner, depth + 1, linked || entry.link);
        }
      }
    };
    seen.add(found.path);
    visit(found.path, found.file, '', 0);
    return files.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
  }

  read(found: Found): string | undefined {
    return this.readBytes(found)?.toString('utf8');
  }

  readBytes(found: Found): Buffer | undefined {
    try {
      if (statSync(found.path).size > this.#limits.maxFileBytes) {
        this.report('too-large', found.file);
        return undefined;
      }
      return readFileSync(found.path);
    } catch {
      this.report('unreadable', found.file);
      return undefined;
    }
  }
}
