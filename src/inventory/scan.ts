import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { knowledgeBase } from '../knowledge/index.ts';
import { shared } from '../knowledge/shared.ts';
import type { AgentId, AgentKnowledge, AgentPath, Fact, FileFormat, Scope } from '../knowledge/types.ts';
import { DEFAULT_LIMITS, ScanFiles } from './files.ts';
import type { Area, Found, TreeFile } from './files.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { scriptPaths } from '../rules/script-paths.ts';
import { isIgnored, parseGitignore } from './gitignore.ts';
import { hookId, numbered, taskId } from './identity.ts';
import { entryText, lookup, readConfig } from './parse.ts';
import type { Component, ComponentKind, Inventory, Limits, ScanOptions, SkillFile, SkillFileType } from './types.ts';

const EXECUTABLE_MAGIC = ['7f454c46', '4d5a', 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', '0061736d'];
const MEDIA_MAGIC = ['89504e47', 'ffd8ff', '47494638', '25504446', '494433', '4f676753', '774f4646', '774f4632', '00010000', '4f54544f', '00000100'];

/** What a file is, from its first bytes: a program, an image, font or document, other binary data, or text. */
export function fileType(bytes: Buffer): SkillFileType {
  const head = bytes.subarray(0, 8).toString('hex');
  if (EXECUTABLE_MAGIC.some((magic) => head.startsWith(magic))) return 'executable';
  const webp = bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
  if (webp || MEDIA_MAGIC.some((magic) => head.startsWith(magic))) return 'media';
  return bytes.subarray(0, 8192).includes(0) ? 'binary' : 'text';
}

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

/** Entries read from one object of settings (variables, plugins, marketplaces). */
const MAX_SETTING_ENTRIES = 256;
/** Names read from one context.fileName, and the length of each. */
const MAX_CONTEXT_NAMES = 32;
const MAX_CONTEXT_NAME_BYTES = 255;

/**
 * A context file name as a relative path with / separators; null for a blank one, which the agent skips too; undefined
 * for one agentcurfew does not follow: not a string, too long, absolute or from home, with .. or wildcards, or with
 * control or invisible characters. Linear in the name.
 */
export function contextName(item: unknown): string | null | undefined {
  if (typeof item !== 'string') return undefined;
  const trimmed = item.trim();
  if (trimmed === '') return null;
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_CONTEXT_NAME_BYTES || /[\p{C}*?[\]{}!\\]/u.test(trimmed)) return undefined;
  if (/^(?:\/|~|[A-Za-z]:)/.test(trimmed)) return undefined;
  const segments = trimmed.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.some((segment) => segment === '..')) return undefined;
  const name = segments.join('/');
  // a /. would leave a name that ends in a space, which the agent's trim and normalize do not agree on.
  // ./~ leaves ~ at the start, which reads as the home folder elsewhere.
  return name === name.trim() && !/^(?:~|[A-Za-z]:)/.test(name) ? name : undefined;
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
    const overlay = new Map<string, Buffer>();
    for (const [relative, text] of options.overlay ?? []) overlay.set(join(this.#root.base, ...relative.split('/')), Buffer.from(text, 'utf8'));
    this.files = new ScanFiles({ ...DEFAULT_LIMITS, ...options.limits }, overlay);
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
        // A path without wildcards names one file per agent, so the files read this way are few: they do not count
        // against the read budget, and filler elsewhere cannot hide them.
        found.push(located?.segments.some((segment) => segment.includes('*')) === false ? { ...match, exempt: true } : match);
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
      const result = readConfig(text, format);
      value = 'value' in result ? result.value : undefined;
      if ('problem' in result) this.files.report(result.problem, found.file);
    }
    this.#parsed.set(found.path, value);
    return value;
  }

  #add(kind: ComponentKind, agent: AgentId, scope: Scope, file: string, name: string, raw: string, files?: readonly SkillFile[], filesRoot?: 'project', id: string = name, whole = false): void {
    const key = `${kind}\0${file}\0${name}`;
    const known = this.#components.get(key);
    if (known === undefined) {
      this.#components.set(key, { kind, agents: [agent], scope, file, name, id, raw, whole, ...(files === undefined ? {} : { files }), ...(files === undefined || filesRoot === undefined ? {} : { filesRoot }) });
    }
    else if (!known.agents.includes(agent)) this.#components.set(key, { ...known, agents: [...known.agents, agent].sort() });
  }

  // The variables that hold the project root in a command, from the knowledge base (CLAUDE_PROJECT_DIR).
  readonly #projectVariables = knowledgeBase.flatMap((agent) => (agent.toolHook === undefined ? [] : factValues(agent.toolHook).map((hook) => hook.projectDirVariable)));
  readonly #scriptCache = new Map<string, readonly SkillFile[] | undefined>();
  #ignore: ReturnType<typeof parseGitignore> | undefined;

  /**
   * Whether a script is part of the repository: not an installed package (node_modules, which depcurfew checks) and not
   * build output or anything else the root .gitignore ignores, which a clone does not bring and a build changes.
   */
  #committed(path: string): boolean {
    if (path.split('/').some((segment) => segment === 'node_modules' || segment === '.git')) return false;
    if (this.#ignore === undefined) {
      const found = this.files.match(this.#root, ['.gitignore'], false)[0];
      const text = found === undefined ? undefined : this.files.read({ ...found, exempt: true });
      this.#ignore = parseGitignore(text ?? '');
    }
    return !isIgnored(this.#ignore, path);
  }

  /**
   * The files of the project that an entry's commands run, read like the files of a skill: through the same limits, and
   * never through a link out of the project. Only project entries: a user's hook runs from a folder the scan cannot know.
   * The command lines are every string of the entry, and every list of strings joined as one line (Codex notify).
   * Installed packages and files the root .gitignore ignores are left out (see #committed).
   */
  #scripts(scope: Scope, raw: string): readonly SkillFile[] | undefined {
    if (scope !== 'project') return undefined;
    if (this.#scriptCache.has(raw)) return this.#scriptCache.get(raw);
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      value = undefined;
    }
    const lines: string[] = [];
    const walk = (item: unknown, depth: number): void => {
      if (depth > 32) return;
      if (typeof item === 'string') lines.push(item);
      else if (Array.isArray(item)) {
        if (item.length > 0 && item.every((word) => typeof word === 'string')) lines.push(item.join(' '));
        for (const inner of item) walk(inner, depth + 1);
      } else if (typeof item === 'object' && item !== null) for (const inner of Object.values(item)) walk(inner, depth + 1);
    };
    walk(value, 0);
    const files = new Map<string, SkillFile>();
    for (const line of lines) {
      for (const path of scriptPaths(line, this.#projectVariables)) {
        if (files.has(path)) continue;
        const found = this.files.match(this.#root, path.split('/'), false)[0];
        const details = found === undefined ? undefined : this.files.details(found);
        if (found === undefined || details === undefined || !this.#committed(path)) continue;
        const flags = { ...(details.link ? { link: true } : {}), ...(details.executable ? { executableBit: true } : {}) };
        const content = this.files.readBytes(found);
        if (content === undefined) {
          files.set(path, { path, bytes: details.bytes, ...flags });
          continue;
        }
        const type = fileType(content);
        files.set(path, type === 'text' ? { path, bytes: details.bytes, type, raw: content.toString('utf8'), content, ...flags } : { path, bytes: details.bytes, type, content, ...flags });
      }
    }
    const result = files.size === 0 ? undefined : [...files.values()].sort((a, b) => compare(a.path, b.path));
    this.#scriptCache.set(raw, result);
    return result;
  }

  #addFile(kind: ComponentKind, agent: AgentId, scope: Scope, found: Found): void {
    const raw = this.files.read(found);
    if (raw !== undefined) this.#add(kind, agent, scope, found.file, baseName(found.file), raw, undefined, undefined, baseName(found.file), true);
  }

  #collectMcp(agent: AgentKnowledge): void {
    for (const mcp of presentValues(agent.mcp)) {
      for (const entry of mcp.files) {
        const format = structured(entry.format);
        if (format === undefined) continue;
        for (const found of this.#find(entry)) {
          const config = this.#config(found, format);
          for (const table of this.#servers(config, entry.serversKey ?? mcp.serversKey)) {
            if (typeof table.value !== 'object' || table.value === null) continue;
            const tableName = (entry.serversKey ?? mcp.serversKey).split('.').at(-1) ?? mcp.serversKey;
            for (const [name, server] of Object.entries(table.value)) {
              this.#add('mcp-server', agent.id, entry.scope, found.file, name, entryText(server));
              // A command the agent runs when it connects to a remote server, checked like the other settings that run one.
              const field = mcp.remote?.headersHelper;
              const helper = field === undefined || typeof server !== 'object' || server === null ? undefined : (server as Record<string, unknown>)[field];
              if (typeof helper !== 'string' || helper.trim() === '') continue;
              const raw = entryText(helper);
              this.#add('command-setting', agent.id, entry.scope, found.file, `${tableName}.${name}.${field}`, raw, this.#scripts(entry.scope, raw), 'project');
            }
          }
        }
      }
    }
  }

  /** Tables of servers at a dotted path; <project> picks the key that names the scanned project. */
  #servers(config: unknown, dotted: string): { value: unknown }[] {
    if (!dotted.includes('<project>')) return lookup(config, dotted);
    const [before, after] = dotted.split('<project>') as [string, string];
    const projects = before === '' ? [{ value: config }] : lookup(config, before.replace(/\.$/, ''));
    const tables: { value: unknown }[] = [];
    for (const { value } of projects) {
      if (typeof value !== 'object' || value === null) continue;
      for (const [key, project] of Object.entries(value)) {
        if (!this.#isRoot(key)) continue;
        tables.push(...(after === '' ? [{ value: project }] : lookup(project, after.replace(/^\./, ''))));
      }
    }
    return tables;
  }

  #isRoot(path: string): boolean {
    try {
      return realpathSync.native(resolve(path)) === this.#root.base;
    } catch {
      return false;
    }
  }

  #frontmatter(found: Found): unknown {
    const key = `frontmatter\0${found.path}`;
    if (this.#parsed.has(key)) return this.#parsed.get(key);
    const text = this.files.read(found);
    let value: unknown;
    if (text !== undefined) {
      const parsed = parseFrontmatter(text);
      if (parsed.status === 'ok') value = parsed.value;
      else if (parsed.status !== 'none') this.files.report(parsed.status, found.file);
    }
    this.#parsed.set(key, value);
    return value;
  }

  #collectHooks(agent: AgentKnowledge): void {
    const autoEvents = new Set(presentValues(agent.autoRun).flatMap((autoRun) => (autoRun.triggerKey.startsWith('hooks.') ? [autoRun.triggerKey.slice('hooks.'.length)] : [])));
    for (const hooks of presentValues(agent.hooks)) {
      for (const event of hooks.autoStartEvents ?? []) autoEvents.add(event);
      for (const entry of hooks.files) {
        if (entry.format === 'markdown-frontmatter') {
          // The skill or subagent is listed with its whole text too; its hooks are listed here one by one.
          const key = entry.key === undefined ? hooks.key : entry.key;
          for (const found of this.#find(entry)) {
            const frontmatter = this.#frontmatter(found);
            for (const table of key === null ? [] : lookup(frontmatter, key)) this.#addEvents(agent.id, entry.scope, found.file, table.value, autoEvents);
          }
          continue;
        }
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
      const ids = numbered(handlers.map((handler) => hookId(event, handler)));
      handlers.forEach((handler, index) => {
        const name = `${event}#${index}`;
        const raw = entryText(handler);
        const scripts = this.#scripts(scope, raw);
        const id = ids[index] ?? name;
        this.#add('hook', agent, scope, file, name, raw, scripts, 'project', id);
        if (autoEvents.has(event)) this.#add('auto-run', agent, scope, file, name, raw, scripts, 'project', id);
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
            const tasks = value.flatMap((item: unknown, index) => {
              if (!lookup(item, autoRun.triggerKey).some((trigger) => trigger.value === autoRun.triggerValue)) return [];
              const label = (item as { label?: unknown }).label;
              const name = typeof label === 'string' ? label : `task#${index}`;
              return [{ item, name, id: taskId(item, name) }];
            });
            const ids = numbered(tasks.map((task) => task.id));
            tasks.forEach((task, index) => {
              const raw = entryText(task.item);
              this.#add('auto-run', agent.id, entry.scope, found.file, task.name, raw, this.#scripts(entry.scope, raw), 'project', ids[index] ?? task.name);
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
          // Settings that turn prompts off are permissions too, also where they are not among the grant keys.
          const keys = new Set([...permissions.keys, ...permissions.bypass.map((setting) => setting.key), ...(permissions.allowAllShell ?? []).map((entry) => entry.key)]);
          for (const key of keys) {
            for (const { path, value } of lookup(config, key)) this.#add('permission', agent.id, entry.scope, found.file, path, entryText(value));
          }
        }
      }
    }
  }

  #collectCommandSettings(agent: AgentKnowledge): void {
    if (agent.commands === undefined) return;
    for (const commands of factValues(agent.commands)) {
      for (const entry of commands.files) {
        const format = structured(entry.format);
        if (format === undefined) continue;
        for (const found of this.#find(entry)) {
          const config = this.#config(found, format);
          for (const setting of commands.settings) {
            // A key the agent ignores in a project file runs nothing from there.
            if (entry.scope === 'project' && setting.fromProject === 'ignored') continue;
            for (const { path, value } of lookup(config, setting.key)) {
              const command = setting.commandField === undefined ? value : typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[setting.commandField] : undefined;
              if (command === undefined || command === null || command === '') continue;
              const raw = entryText(value);
              const scripts = this.#scripts(entry.scope, raw);
              this.#add('command-setting', agent.id, entry.scope, found.file, path, raw, scripts, 'project');
              if (setting.runs === 'session-start') this.#add('auto-run', agent.id, entry.scope, found.file, path, raw, scripts, 'project');
            }
          }
        }
      }
    }
  }

  /** The entries of a settings object, at most MAX_SETTING_ENTRIES; past that the file is reported, so that padding cannot hide one. */
  #entries(value: unknown, file: string): [string, unknown][] {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
    const entries = Object.entries(value);
    if (entries.length <= MAX_SETTING_ENTRIES) return entries;
    this.files.report('too-many-entries', file);
    return entries.slice(0, MAX_SETTING_ENTRIES);
  }

  /** Settings files of the agent, parsed, with the scope of each. */
  *#settingsFiles(files: readonly AgentPath[]): Generator<{ entry: AgentPath; found: Found; config: unknown }> {
    for (const entry of files) {
      const format = structured(entry.format);
      if (format === undefined) continue;
      for (const found of this.#find(entry)) yield { entry, found, config: this.#config(found, format) };
    }
  }

  /**
   * Settings that redirect the agent or bring code into it without running a command themselves (D-045): each variable of
   * the env block, each plugin turned on or off, each marketplace. A variable that wraps the agent's commands
   * (CLAUDE_CODE_SHELL_PREFIX) and a marketplace's headersHelper are also command settings, with their scripts.
   */
  #collectSettings(agent: AgentKnowledge): void {
    for (const env of agent.env === undefined ? [] : factValues(agent.env)) {
      const wrappers = new Set(env.variables.filter((variable) => variable.effect === 'command-wrapper').map((variable) => variable.name));
      for (const { entry, found, config } of this.#settingsFiles(env.files)) {
        for (const { path, value } of lookup(config, env.key)) {
          for (const [name, item] of this.#entries(value, found.file)) {
            const raw = entryText({ [name]: item });
            this.#add('setting', agent.id, entry.scope, found.file, `${path}.${name}`, raw);
            if (wrappers.has(name) && typeof item === 'string' && item.trim() !== '') {
              const command = entryText(item);
              this.#add('command-setting', agent.id, entry.scope, found.file, `${path}.${name}`, command, this.#scripts(entry.scope, command), 'project');
            }
          }
        }
      }
    }
    for (const off of agent.hooksOff === undefined ? [] : factValues(agent.hooksOff)) {
      for (const { entry, found, config } of this.#settingsFiles(off.files)) {
        for (const { path, value } of lookup(config, off.key)) this.#add('setting', agent.id, entry.scope, found.file, path, entryText(value));
      }
    }
    for (const plugins of agent.plugins === undefined ? [] : factValues(agent.plugins)) {
      const helpers = new Map(plugins.sources.flatMap((source) => (source.headersHelper === undefined ? [] : [[source.type, source.headersHelper] as const])));
      for (const { entry, found, config } of this.#settingsFiles(plugins.files)) {
        for (const { path, value } of lookup(config, plugins.enabledKey)) {
          for (const [name, item] of this.#entries(value, found.file)) this.#add('setting', agent.id, entry.scope, found.file, `${path}.${name}`, entryText(item));
        }
        for (const key of plugins.marketplacesKeys) {
          for (const { path, value } of lookup(config, key)) {
            for (const [name, item] of this.#entries(value, found.file)) {
              this.#add('setting', agent.id, entry.scope, found.file, `${path}.${name}`, entryText(item));
              const source = typeof item === 'object' && item !== null ? (item as Record<string, unknown>).source : undefined;
              const type = typeof source === 'object' && source !== null ? (source as Record<string, unknown>).source : undefined;
              const field = typeof type === 'string' ? helpers.get(type) : undefined;
              const helper = field === undefined ? undefined : (source as Record<string, unknown>)[field];
              if (typeof helper !== 'string' || helper.trim() === '') continue;
              const raw = entryText(helper);
              this.#add('command-setting', agent.id, entry.scope, found.file, `${path}.${name}.source.${field}`, raw, this.#scripts(entry.scope, raw), 'project');
            }
          }
        }
      }
    }
  }

  /**
   * Context files named by a setting (Gemini CLI context.fileName), read where the default one is. A name is followed only
   * when it is a plain relative path: one that leaves the project, starts at the root or home, holds wildcards or hidden
   * characters is not read, and the settings file is reported, so that a name like ** cannot pull the whole tree in.
   */
  #collectContextNames(agent: AgentKnowledge): void {
    for (const names of agent.contextNames === undefined ? [] : factValues(agent.contextNames)) {
      for (const { entry, found, config } of this.#settingsFiles(names.files)) {
        for (const { path, value } of lookup(config, names.key)) {
          this.#add('setting', agent.id, entry.scope, found.file, path, entryText(value));
          const list = (typeof value === 'string' ? [value] : Array.isArray(value) ? value : []).slice(0, MAX_CONTEXT_NAMES);
          if (Array.isArray(value) && value.length > MAX_CONTEXT_NAMES) this.files.report('too-many-entries', found.file);
          for (const item of list) {
            const name = contextName(item);
            if (name === null) continue;
            if (name === undefined) {
              this.files.report('unparsable', found.file);
              continue;
            }
            for (const location of names.locations) {
              // A function, so that $& and the like in a name are not replacement patterns.
              const file = { ...location, path: location.path.replace('<name>', () => name) };
              for (const match of this.#find(file)) this.#addFile('context-file', agent.id, location.scope, match);
            }
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
          const files = this.files.tree(parent).map((inner) => this.#skillFile(inner));
          this.#add('skill', agent.id, directory.scope, found.file, baseName(folder), raw, files, undefined, baseName(folder), true);
        }
      }
    }
  }

  #skillFile(inner: TreeFile): SkillFile {
    const { relative: path, bytes } = inner;
    const flags = { ...(inner.link ? { link: true } : {}), ...(inner.executable ? { executableBit: true } : {}) };
    const content = this.files.readBytes(inner.found);
    if (content === undefined) return { path, bytes, ...flags };
    const type = fileType(content);
    return type === 'text' ? { path, bytes, type, raw: content.toString('utf8'), content, ...flags } : { path, bytes, type, content, ...flags };
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
      this.#collectCommandSettings(agent);
      this.#collectSettings(agent);
      this.#collectContextNames(agent);
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

/** A skill folder anywhere, such as one downloaded but not installed yet, as the component the rules check. */
export function scanSkillFolder(folder: string, limits: Partial<Limits> = {}): Inventory {
  const format = shared.skillFormat.status === 'disputed' ? shared.skillFormat.variants[0].value : shared.skillFormat.value;
  const files = new ScanFiles({ ...DEFAULT_LIMITS, ...limits });
  const area = { base: realpathSync.native(folder), label: '' };
  const entry = files.match(area, [format.entryFile], false)[0];
  if (entry === undefined) return { components: [], problems: [...files.problems] };
  const raw = files.read(entry);
  if (raw === undefined) return { components: [], problems: [...files.problems] };
  const skillFiles: SkillFile[] = files.tree({ path: area.base, file: '', area }).map((inner) => {
    const flags = { ...(inner.link ? { link: true } : {}), ...(inner.executable ? { executableBit: true } : {}) };
    const content = files.readBytes(inner.found);
    if (content === undefined) return { path: inner.relative, bytes: inner.bytes, ...flags };
    const type = fileType(content);
    return type === 'text' ? { path: inner.relative, bytes: inner.bytes, type, raw: content.toString('utf8'), content, ...flags } : { path: inner.relative, bytes: inner.bytes, type, content, ...flags };
  });
  const agents = knowledgeBase.filter((agent) => presentValues(agent.skills).length > 0).map((agent) => agent.id).sort();
  const name = area.base.split(/[\\/]/).at(-1) ?? 'skill';
  return { components: [{ kind: 'skill', agents, scope: 'project', file: format.entryFile, name, raw, files: skillFiles }], problems: [...files.problems] };
}

