import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { InventoryProblem, Limits, ProblemCode } from './types.ts';

// maxTotalBytes keeps memory bounded: a skill folder can hold thousands of copies of one 2 MB file, which git stores once.
export const DEFAULT_LIMITS: Limits = { maxFileBytes: 2 * 1024 * 1024, maxDepth: 32, maxEntries: 200_000, maxTotalBytes: 128 * 1024 * 1024 };

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

interface Entry {
  kind: Kind;
  real: string;
  bytes: number;
  link: boolean;
  executable: boolean;
}

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
  #bytes = 0;

  readonly #overlay: ReadonlyMap<string, Buffer>;

  /** `overlay` maps absolute paths to the bytes they are read as; see ScanOptions.overlay. */
  constructor(limits: Limits, overlay: ReadonlyMap<string, Buffer> = new Map()) {
    this.#limits = limits;
    this.#overlay = overlay;
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
    // An overlaid file shows up in every folder above it, also in folders that do not exist yet: a write of
    // .claude/skills/new/SKILL.md creates the folder new.
    const overlaid = new Set<string>();
    for (const key of this.#overlay.keys()) {
      if (key.startsWith(path + sep)) overlaid.add(key.slice(path.length + 1).split(sep)[0] ?? '');
    }
    overlaid.delete('');
    try {
      names = readdirSync(path).sort();
    } catch {
      if (overlaid.size === 0) this.report('unreadable', file === '' ? '.' : file);
    }
    for (const name of overlaid) if (!names.includes(name)) names = [...names, name].sort();
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
  // Every ** pattern of the knowledge base walks the same tree, so what is at a path is looked up once per scan.
  readonly #kinds = new Map<string, Entry | undefined>();

  #kind(area: Area, path: string, file: string): Entry | undefined {
    const key = `${area.base}\0${path}`;
    if (this.#kinds.has(key)) {
      const known = this.#kinds.get(key);
      if (known === undefined && this.#outside.has(key)) this.report('outside-project', file);
      return known;
    }
    const entry = this.#lookup(area, path, file);
    this.#kinds.set(key, entry);
    return entry;
  }

  readonly #outside = new Set<string>();

  #lookup(area: Area, path: string, file: string): Entry | undefined {
    const overlaid = this.#overlay.get(path);
    if (overlaid !== undefined) return { kind: 'file', real: path, bytes: overlaid.length, link: false, executable: false };
    if ([...this.#overlay.keys()].some((key) => key.startsWith(path + sep))) {
      try {
        if (lstatSync(path).isDirectory()) return { kind: 'directory', real: path, bytes: 0, link: false, executable: false };
      } catch {
        return { kind: 'directory', real: path, bytes: 0, link: false, executable: false };
      }
    }
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
        this.#outside.add(`${area.base}\0${path}`);
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

  /** Whether a file of this size may be read, within the limit for one file and the limit for the scan; counts it if so. */
  #fits(size: number): boolean {
    const total = this.#limits.maxTotalBytes ?? DEFAULT_LIMITS.maxTotalBytes ?? Infinity;
    if (size > this.#limits.maxFileBytes || this.#bytes + size > total) return false;
    this.#bytes += size;
    return true;
  }

  // Several agents read the same files, so each is read once per scan; that also counts its bytes once.
  readonly #read = new Map<string, Buffer | ProblemCode>();

  readBytes(found: Found): Buffer | undefined {
    let result = this.#read.get(found.path);
    if (result === undefined) {
      result = this.#readOnce(found);
      this.#read.set(found.path, result);
    }
    if (typeof result !== 'string') return result;
    this.report(result, found.file);
    return undefined;
  }

  #readOnce(found: Found): Buffer | ProblemCode {
    const overlaid = this.#overlay.get(found.path);
    if (overlaid !== undefined) {
      if (!this.#fits(overlaid.length)) {
        return 'too-large';
      }
      return overlaid;
    }
    try {
      if (!this.#fits(statSync(found.path).size)) {
        return 'too-large';
      }
      return readFileSync(found.path);
    } catch {
      return 'unreadable';
    }
  }
}
