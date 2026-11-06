import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_LIMITS } from '../inventory/files.ts';
import { parseConfig } from '../inventory/parse.ts';
import type { ComponentKind } from '../inventory/types.ts';
import type { LockedComponent, LockedServer, LockedSkill, Lockfile } from './types.ts';
import { LOCKFILE, LOCKFILE_VERSION } from './types.ts';

export type LockRead = { status: 'missing' } | { status: 'invalid'; reason: string } | { status: 'ok'; lock: Lockfile; text: string };

const KINDS: ReadonlySet<string> = new Set<ComponentKind>(['skill', 'mcp-server', 'hook', 'auto-run', 'context-file', 'permission', 'subagent', 'command']);
const HASH = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function server(value: unknown): LockedServer | undefined {
  if (!isRecord(value)) return undefined;
  const { command, args, urls, env, headers } = value;
  if ((command !== null && typeof command !== 'string') || !strings(args) || !strings(urls) || !strings(env) || !strings(headers)) return undefined;
  const ref = value.package;
  let pkg: LockedServer['package'] = null;
  if (ref !== null) {
    if (!isRecord(ref) || !['npm', 'pypi', 'oci'].includes(ref.ecosystem as string) || typeof ref.name !== 'string' || (ref.version !== null && typeof ref.version !== 'string')) return undefined;
    pkg = { ecosystem: ref.ecosystem as 'npm', name: ref.name, version: ref.version as string | null };
  }
  return { command, args, urls, env, headers, package: pkg };
}

function skill(value: unknown): LockedSkill | undefined {
  if (!isRecord(value) || !Array.isArray(value.files) || !strings(value.executables) || !strings(value.executableBits)) return undefined;
  const files = [];
  for (const file of value.files) {
    if (!isRecord(file) || typeof file.path !== 'string' || typeof file.hash !== 'string') return undefined;
    files.push({ path: file.path, hash: file.hash });
  }
  return { files, executables: value.executables, executableBits: value.executableBits };
}

function component(value: unknown): LockedComponent | undefined {
  if (!isRecord(value)) return undefined;
  const { kind, file, name, agents, hash } = value;
  if (typeof kind !== 'string' || !KINDS.has(kind) || typeof file !== 'string' || typeof name !== 'string' || !strings(agents) || typeof hash !== 'string' || !HASH.test(hash)) return undefined;
  const base: LockedComponent = { kind: kind as ComponentKind, file, name, agents, hash };
  if (value.server !== undefined) {
    const parsed = server(value.server);
    if (parsed === undefined) return undefined;
    base.server = parsed;
  }
  if (value.skill !== undefined) {
    const parsed = skill(value.skill);
    if (parsed === undefined) return undefined;
    base.skill = parsed;
  }
  return base;
}

/** Checks the shape of a parsed lock; the reason names the first problem and carries no text from the file. */
export function parseLock(value: unknown): { lock: Lockfile } | { reason: string } {
  if (!isRecord(value)) return { reason: 'it is not a JSON object' };
  if (value.lockfileVersion !== LOCKFILE_VERSION) return { reason: `lockfileVersion is not ${LOCKFILE_VERSION}` };
  if (value.algorithm !== 'sha256') return { reason: 'algorithm is not sha256' };
  if (!Array.isArray(value.components)) return { reason: 'components is not a list' };
  const components: LockedComponent[] = [];
  for (const [index, item] of value.components.entries()) {
    const parsed = component(item);
    if (parsed === undefined) return { reason: `component ${index} does not have the expected fields` };
    components.push(parsed);
  }
  return { lock: { lockfileVersion: LOCKFILE_VERSION, algorithm: 'sha256', components } };
}

/** Reads agentcurfew.lock of a project, which is as untrusted as any other file there: size limit, no links. */
export function readLock(root: string, maxBytes = DEFAULT_LIMITS.maxFileBytes): LockRead {
  const path = join(root, LOCKFILE);
  let text: string;
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return { status: 'invalid', reason: 'it is a link, which is not followed' };
    if (!stat.isFile()) return { status: 'invalid', reason: 'it is not a file' };
    if (stat.size > maxBytes) return { status: 'invalid', reason: 'it is over the size limit' };
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    return { status: 'invalid', reason: 'it could not be read' };
  }
  const value = parseConfig(text, 'json');
  if (value === undefined) return { status: 'invalid', reason: 'it is not valid JSON' };
  const parsed = parseLock(value);
  return 'reason' in parsed ? { status: 'invalid', reason: parsed.reason } : { status: 'ok', lock: parsed.lock, text };
}
