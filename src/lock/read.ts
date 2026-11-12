import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../inventory/parse.ts';
import { COMPONENT_KINDS } from '../inventory/types.ts';
import type { ComponentKind } from '../inventory/types.ts';
import type { LockedComponent, LockedServer, LockedSkill, LockedSkillFile, Lockfile } from './types.ts';
import { LOCKFILE, LOCKFILE_VERSION } from './types.ts';

export type LockRead = { status: 'missing' } | { status: 'invalid'; reason: string } | { status: 'ok'; lock: Lockfile; text: string };

const KINDS: ReadonlySet<string> = new Set<ComponentKind>(COMPONENT_KINDS);
const HASH = /^[0-9a-f]{64}$/;
const ECOSYSTEM = /^[a-z0-9-]+$/;
const KNOWN_ECOSYSTEMS: ReadonlySet<string> = new Set<string>(['npm', 'pypi', 'oci']);

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
    if (!isRecord(ref) || !KNOWN_ECOSYSTEMS.has(ref.ecosystem as string) || typeof ref.name !== 'string' || (ref.version !== null && typeof ref.version !== 'string')) return undefined;
    pkg = { ecosystem: ref.ecosystem as 'npm', name: ref.name, version: ref.version as string | null };
  }
  return { command, args, urls, env, headers, package: pkg };
}

function fileList(value: unknown): LockedSkillFile[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const files = [];
  for (const file of value) {
    if (!isRecord(file) || typeof file.path !== 'string' || typeof file.hash !== 'string') return undefined;
    files.push({ path: file.path, hash: file.hash });
  }
  return files;
}

function skill(value: unknown): LockedSkill | undefined {
  if (!isRecord(value) || !strings(value.executables) || !strings(value.executableBits)) return undefined;
  const files = fileList(value.files);
  if (files === undefined) return undefined;
  return { files, executables: value.executables, executableBits: value.executableBits };
}

function component(value: unknown): LockedComponent | undefined {
  if (!isRecord(value)) return undefined;
  const { kind, file, name, agents, hash } = value;
  if (typeof kind !== 'string' || !KINDS.has(kind) || typeof file !== 'string' || typeof name !== 'string' || !strings(agents) || typeof hash !== 'string' || !HASH.test(hash)) return undefined;
  const base: LockedComponent = { kind: kind as ComponentKind, file, name, agents, hash };
  if (value.id !== undefined) {
    if (typeof value.id !== 'string' || value.id === '') return undefined;
    base.id = value.id;
  }
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
  if (value.scripts !== undefined) {
    const parsed = fileList(value.scripts);
    if (parsed === undefined) return undefined;
    base.scripts = parsed;
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
  let unknownKinds = 0;
  let unknownPackages = 0;
  for (const [index, item] of value.components.entries()) {
    // A kind added by a later version is skipped and counted, so that a lock it wrote is still checked for the rest (D-045).
    if (isRecord(item) && typeof item.kind === 'string' && !KINDS.has(item.kind)) {
      unknownKinds++;
      continue;
    }
    // A server package in an ecosystem a later version introduced is skipped and counted, like unknownKinds.
    // The ecosystem must still be a lowercase slug; a malformed value rejects the lock in component() below.
    if (isRecord(item) && isRecord(item.server) && isRecord(item.server.package)) {
      const eco = item.server.package.ecosystem;
      if (typeof eco === 'string' && ECOSYSTEM.test(eco) && !KNOWN_ECOSYSTEMS.has(eco)) {
        unknownPackages++;
        continue;
      }
    }
    const parsed = component(item);
    if (parsed === undefined) return { reason: `component ${index} does not have the expected fields` };
    components.push(parsed);
  }
  return { lock: { lockfileVersion: LOCKFILE_VERSION, algorithm: 'sha256', components, ...(unknownKinds > 0 ? { unknownKinds } : {}), ...(unknownPackages > 0 ? { unknownPackages } : {}) } };
}

/**
 * The largest agentcurfew.lock read. A lock lists every file of every skill, so a large project's lock outgrows the
 * limit of the files agentcurfew scans; it is still bounded, since it is as untrusted as any other file.
 */
export const MAX_LOCK_BYTES = 64 * 1024 * 1024;

/** Reads agentcurfew.lock of a project, which is as untrusted as any other file there: size limit, no links. */
export function readLock(root: string, maxBytes = MAX_LOCK_BYTES): LockRead {
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
