import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { knowledgeBase } from '../knowledge/index.ts';
import type { AgentId, AgentKnowledge, AgentPath, Fact, FileFormat, Scope } from '../knowledge/types.ts';
import { DEFAULT_LIMITS, ScanFiles } from './files.ts';
import type { Area, Found } from './files.ts';
import { entryText, lookup, parseConfig } from './parse.ts';
import type { Component, ComponentKind, Inventory, ScanOptions, SkillFile } from './types.ts';

/** Every value a fact may hold: a disputed fact counts in all its variants, so that nothing is missed. */
function factValues<T>(fact: Fact<T>): readonly T[] {
  return fact.status === 'disputed' ? fact.variants.map((variant) => variant.value) : [fact.value];
}

function presentValues<T>(fact: Fact<T | null>): readonly T[] {
  return factValues(fact).filter((value): value is NonNullable<typeof value> => value !== null) as T[];
}

function baseName(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1);
}

function structured(format: FileFormat): 'json' | 'toml' | undefined {
  if (format === 'json' || format === 'jsonc') return 'json';
  return format === 'toml' ? 'toml' : undefined;
}

function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

const EXTENSIONS: Partial<Record<FileFormat, string>> = { json: '.json', jsonc: '.json', toml: '.toml', markdown: '.md', 'markdown-frontmatter': '.md' };

class Scan {
  readonly files: ScanFiles;
  readonly #options: ScanOptions;
  readonly #root: Area;
  readonly #platform: NodeJS.Platform;
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #components = new Map<string, Component>();
  readonly #matches = new Map<string, readonly Found[]>();
  readonly #parsed = new Map<string, unknown>();

  constructor(options: ScanOptions) {
    this.#options = options;
    this.#root = { base: realpathSync.native(options.root), label: '' };
    this.#platform = options.platform ?? process.platform;
    this.#env = options.env ?? process.env;
    this.files = new ScanFiles({ ...DEFAULT_LIMITS, ...options.limits });
  }

  /** The area of a path of the knowledge base and the pattern below it; undefined when it does not apply here. */
  #locate(entry: AgentPath): { area: Area; segments: string[] } | undefined {
    if (entry.scope === 'project') return { area: this.#root, segments: entry.path.split('/') };
    if (this.#options.user !== true) return undefined;
    if (entry.platforms !== undefined && !entry.platforms.includes(this.#platform as 'linux')) return undefined;
    const [first, ...rest] = entry.path.split('/') as [string, ...string[]];
    if (first === '~') return this.#area(this.#options.home ?? homedir(), '~', rest);
    const variable = /^%(\w+)%$/.exec(first)?.[1];
    if (variable !== undefined) {
      const value = this.#env[variable];
      return this.#platform === 'win32' && value ? this.#area(value, first, rest) : undefined;
    }
    const windowsPath = /^[A-Za-z]:$/.test(first);
    if (windowsPath !== (this.#platform === 'win32')) return undefined;
    const literal = rest.findIndex((segment) => segment.includes('*'));
    const end = literal === -1 ? rest.length - 1 : literal;
    const prefix = [first, ...rest.slice(0, end)].join('/');
    return this.#area(prefix === '' ? '/' : prefix, prefix, rest.slice(end));
  }

  #area(path: string, label: string, segments: string[]): { area: Area; segments: string[] } | undefined {
    try {
      return { area: { base: realpathSync.native(path), label }, segments };
    } catch {
      return undefined;
    }
  }

  /** Files a path of the knowledge base names. A directory counts only when `walk`: then its files of that format do. */
  #find(entry: AgentPath, walk = false): readonly Found[] {
    const key = `${walk}\0${entry.scope}\0${entry.path}`;
    const cached = this.#matches.get(key);
    if (cached !== undefined) return cached;
    const located = this.#locate(entry);
    const found: Found[] = [];
    for (const match of located === undefined ? [] : this.files.match(located.area, located.segments, walk)) {
      if (!walk || !this.files.isDirectory(match)) {
        found.push(match);
        continue;
      }
      const extension = EXTENSIONS[entry.format];
      for (const inner of this.files.tree(match)) if (extension === undefined || inner.relative.endsWith(extension)) found.push(inner.found);
    }
    this.#matches.set(key, found);
    return found;
  }

  #config(found: Found, format: 'json' | 'toml'): unknown {
    if (this.#parsed.has(found.path)) return this.#parsed.get(found.path);
    const text = this.files.read(found);
    let value: unknown;
    if (text !== undefined) {
      value = parseConfig(text, format);
      if (value === undefined) this.files.report('unparsable', found.file);
    }
    this.#parsed.set(found.path, value);
    return value;
  }

  #add(kind: ComponentKind, agent: AgentId, scope: Scope, file: string, name: string, raw: string, files?: readonly SkillFile[]): void {
    const key = `${kind}\0${file}\0${name}`;
    const known = this.#components.get(key);
    if (known === undefined) this.#components.set(key, { kind, agents: [agent], scope, file, name, raw, ...(files === undefined ? {} : { files }) });
    else if (!known.agents.includes(agent)) this.#components.set(key, { ...known, agents: [...known.agents, agent].sort() });
  }

  #addFile(kind: ComponentKind, agent: AgentId, scope: Scope, found: Found): void {
    const raw = this.files.read(found);
    if (raw !== undefined) this.#add(kind, agent, scope, found.file, baseName(found.file), raw);
  }

  #collectMcp(agent: AgentKnowledge): void {
    for (const mcp of presentValues(agent.mcp)) {
      for (const entry of mcp.files) {
        const format = structured(entry.format);
        if (format === undefined) continue;
        for (const found of this.#find(entry)) {
          const config = this.#config(found, format);
          for (const table of lookup(config, entry.serversKey ?? mcp.serversKey)) {
            if (typeof table.value !== 'object' || table.value === null) continue;
            for (const [name, server] of Object.entries(table.value)) this.#add('mcp-server', agent.id, entry.scope, found.file, name, entryText(server));
          }
        }
      }
    }
  }

  #collectHooks(agent: AgentKnowledge): void {
    const autoEvents = new Set(presentValues(agent.autoRun).flatMap((autoRun) => (autoRun.triggerKey.startsWith('hooks.') ? [autoRun.triggerKey.slice('hooks.'.length)] : [])));
    for (const hooks of presentValues(agent.hooks)) {
      for (const entry of hooks.files) {
        // Hooks in frontmatter are part of the skill or subagent, which the inventory lists with its whole text.
        if (entry.format === 'markdown-frontmatter') continue;
        const format = structured(entry.format);
        for (const found of this.#find(entry)) {
          if (format === undefined) {
            this.#addFile('hook', agent.id, entry.scope, found);
            continue;
          }
          const key = entry.key === undefined ? hooks.key : entry.key;
          const config = this.#config(found, format);
          const tables = key === null ? [{ value: config }] : lookup(config, key);
          for (const table of tables) this.#addEvents(agent.id, entry.scope, found.file, table.value, autoEvents);
        }
      }
    }
  }

  #addEvents(agent: AgentId, scope: Scope, file: string, table: unknown, autoEvents: ReadonlySet<string>): void {
    if (typeof table !== 'object' || table === null) return;
    for (const [event, value] of Object.entries(table)) {
      if (typeof value !== 'object' || value === null) continue;
      const handlers = (Array.isArray(value) ? value : [value]).flatMap((item: unknown) => {
        const nested = (item as { hooks?: unknown } | null)?.hooks;
        if (!Array.isArray(nested)) return [item];
        const { hooks: _hooks, ...group } = item as Record<string, unknown>;
        return nested.map((handler: unknown) => ({ ...group, handler }));
      });
      handlers.forEach((handler, index) => {
        const name = `${event}#${index}`;
        this.#add('hook', agent, scope, file, name, entryText(handler));
        if (autoEvents.has(event)) this.#add('auto-run', agent, scope, file, name, entryText(handler));
      });
    }
  }

  #collectAutoRun(agent: AgentKnowledge): void {
    for (const autoRun of presentValues(agent.autoRun)) {
      if (autoRun.triggerKey.startsWith('hooks.')) continue;
      for (const entry of autoRun.files) {
        const format = structured(entry.format);
        for (const found of this.#find(entry)) {
          if (autoRun.containerKey === undefined || format === undefined) {
            this.#addFile('auto-run', agent.id, entry.scope, found);
            continue;
          }
          for (const { value } of lookup(this.#config(found, format), autoRun.containerKey)) {
            if (!Array.isArray(value)) continue;
            value.forEach((item: unknown, index) => {
              if (!lookup(item, autoRun.triggerKey).some((trigger) => trigger.value === autoRun.triggerValue)) return;
              const label = (item as { label?: unknown }).label;
              this.#add('auto-run', agent.id, entry.scope, found.file, typeof label === 'string' ? label : `task#${index}`, entryText(item));
            });
          }
        }
      }
    }
  }

  #collectPermissions(agent: AgentKnowledge): void {
    for (const permissions of presentValues(agent.permissions)) {
      for (const entry of permissions.files) {
        const format = structured(entry.format);
        for (const found of this.#find(entry, true)) {
          if (format === undefined) {
            this.#addFile('permission', agent.id, entry.scope, found);
            continue;
          }
          const config = this.#config(found, format);
          for (const key of permissions.keys) {
            for (const { path, value } of lookup(config, key)) this.#add('permission', agent.id, entry.scope, found.file, path, entryText(value));
          }
        }
      }
    }
  }

  #collectSkills(agent: AgentKnowledge): void {
    for (const skills of presentValues(agent.skills)) {
      for (const directory of skills.directories) {
        const pattern = { ...directory, path: `${directory.path}/*/${skills.entryFile}` };
        for (const found of this.#find(pattern)) {
          const raw = this.files.read(found);
          if (raw === undefined) continue;
          const folder = found.file.slice(0, found.file.lastIndexOf('/'));
          const parent = { path: found.path.slice(0, -skills.entryFile.length - 1), file: folder, area: found.area };
          const files = this.files.tree(parent).map(({ relative, bytes }) => ({ path: relative, bytes }));
          this.#add('skill', agent.id, directory.scope, found.file, baseName(folder), raw, files);
        }
      }
    }
  }

  #collectFiles(agent: AgentKnowledge): void {
    for (const contextFiles of factValues(agent.contextFiles)) {
      for (const entry of contextFiles) for (const found of this.#find(entry)) this.#addFile('context-file', agent.id, entry.scope, found);
    }
    for (const extensions of presentValues(agent.extensions)) {
      for (const entry of extensions.subagents) for (const found of this.#find(entry, true)) this.#addFile('subagent', agent.id, entry.scope, found);
      for (const entry of extensions.commands) for (const found of this.#find(entry, true)) this.#addFile('command', agent.id, entry.scope, found);
    }
  }

  run(): Inventory {
    for (const agent of knowledgeBase) {
      this.#collectMcp(agent);
      this.#collectHooks(agent);
      this.#collectAutoRun(agent);
      this.#collectPermissions(agent);
      this.#collectSkills(agent);
      this.#collectFiles(agent);
    }
    const components = [...this.#components.values()].sort((a, b) => compare(a.kind, b.kind) || compare(a.file, b.file) || compare(a.name, b.name));
    const problems = [...this.files.problems].sort((a, b) => compare(a.file, b.file) || compare(a.code, b.code));
    return { components, problems };
  }
}

/** Reads what steers agents in a project. It only reads files: nothing it finds is run, and it uses no network. */
export function scanInventory(options: ScanOptions): Inventory {
  return new Scan(options).run();
}
