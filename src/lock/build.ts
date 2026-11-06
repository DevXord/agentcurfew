import type { Component, Inventory, SkillFile } from '../inventory/types.ts';
import { knowledgeBase } from '../knowledge/index.ts';
import type { AgentKnowledge } from '../knowledge/types.ts';
import { launch, packageRef } from '../rules/launch.ts';
import { commandLine, mcpEntry } from '../rules/mcp.ts';
import { entryValue, isWholeFile } from '../rules/text.ts';
import { canonicalJson, normalizeText, sha256 } from './hash.ts';
import { redact } from './redact.ts';
import type { LockedComponent, LockedServer, LockedSkill, Lockfile } from './types.ts';
import { LOCKFILE_VERSION } from './types.ts';

const SCRIPT = /\.(?:sh|bash|zsh|fish|ps1|psm1|py|js|mjs|cjs|ts|mts|cts|rb|pl|php|lua|bat|cmd|exe|com|jar)$/i;

function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The checksum of one file of a skill: text normalized like every text, other files byte for byte. */
export function skillFileHash(file: SkillFile): string | undefined {
  if (file.content === undefined) return undefined;
  return file.type === 'text' ? sha256(normalizeText(file.content.toString('utf8'))) : sha256(file.content);
}

function isExecutable(file: SkillFile): boolean {
  return file.type === 'executable' || SCRIPT.test(file.path) || (file.raw !== undefined && file.raw.startsWith('#!'));
}

function lockSkill(component: Component): { hash: string; skill: LockedSkill } {
  const files = (component.files ?? [])
    .map((file) => ({ path: file.path, hash: skillFileHash(file) ?? 'unreadable' }))
    .sort((a, b) => compare(a.path, b.path));
  const all = component.files ?? [];
  const skill: LockedSkill = {
    files,
    executables: all.filter(isExecutable).map((file) => file.path).sort(compare),
    executableBits: all.filter((file) => file.executableBit === true).map((file) => file.path).sort(compare),
  };
  return { hash: sha256(JSON.stringify(files.map((file) => [file.path, file.hash]))), skill };
}

function lockServer(component: Component, knowledge: readonly AgentKnowledge[]): LockedServer | undefined {
  const entry = mcpEntry(component, knowledge);
  if (entry === undefined) return undefined;
  const started = launch(commandLine(entry));
  return {
    command: entry.command === undefined ? null : redact(entry.command),
    args: entry.args.map(redact),
    urls: entry.urls.map(redact),
    env: Object.keys(entry.env).sort(compare),
    headers: Object.keys(entry.headers).sort(compare),
    package: started === undefined ? null : (packageRef(started) ?? null),
  };
}

function componentHash(component: Component): string {
  if (isWholeFile(component)) return sha256(normalizeText(component.raw));
  const value = entryValue(component);
  return sha256(value === undefined ? normalizeText(component.raw) : canonicalJson(value));
}

/** The lock of an inventory: project components only, in the inventory's order, with nothing machine-specific. */
export function buildLock(inventory: Inventory, knowledge: readonly AgentKnowledge[] = knowledgeBase): Lockfile {
  const components: LockedComponent[] = [];
  for (const component of inventory.components) {
    if (component.scope !== 'project') continue;
    const base = { kind: component.kind, file: component.file, name: component.name, agents: [...component.agents] };
    if (component.kind === 'skill') {
      const { hash, skill } = lockSkill(component);
      components.push({ ...base, hash, skill });
      continue;
    }
    const server = component.kind === 'mcp-server' ? lockServer(component, knowledge) : undefined;
    components.push({ ...base, hash: componentHash(component), ...(server === undefined ? {} : { server }) });
  }
  return { lockfileVersion: LOCKFILE_VERSION, algorithm: 'sha256', components };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.keys(value).sort(compare).map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]));
  }
  return value;
}

/** The lock as written: sorted keys, 2-space indent, a final newline, no time stamps. */
export function serializeLock(lock: Lockfile): string {
  return `${JSON.stringify(sortKeys(lock), null, 2)}\n`;
}
