import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_LIMITS } from '../inventory/files.ts';
import { parseConfig } from '../inventory/parse.ts';
import type { Component } from '../inventory/types.ts';
import { shared } from '../knowledge/shared.ts';

const LOCK = shared.skillsLock.status === 'disputed' ? shared.skillsLock.variants[0].value : shared.skillsLock.value;
const SKIPPED_FOLDERS = new Set(['.git', 'node_modules']);

/**
 * computedHash of skills-lock.json over an installed skill folder, as the knowledge base describes it: SHA-256 over each
 * file's path and raw bytes, sorted with localeCompare, skipping .git, node_modules and links. Undefined when a file
 * could not be read, since the hash would then be wrong.
 */
export function computedHash(component: Component): string | undefined {
  const files = (component.files ?? []).filter((file) => file.link !== true && !file.path.split('/').some((segment) => SKIPPED_FOLDERS.has(segment)));
  if (files.some((file) => file.content === undefined)) return undefined;
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path, 'utf8');
    hash.update(file.content as Buffer);
  }
  return hash.digest('hex');
}

export interface SkillsLockEntry {
  name: string;
  computedHash: string;
  sourceType: string;
}

export type SkillsLockRead = { status: 'missing' } | { status: 'invalid' } | { status: 'ok'; file: string; entries: SkillsLockEntry[] };

/** skills-lock.json at the project root, read with the same limits as every other file. */
export function readSkillsLock(root: string, maxBytes = DEFAULT_LIMITS.maxFileBytes): SkillsLockRead {
  const path = join(root, LOCK.file);
  let text: string;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > maxBytes) return { status: 'invalid' };
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { status: 'missing' } : { status: 'invalid' };
  }
  const value = parseConfig(text, 'json') as Record<string, unknown> | undefined;
  if (typeof value !== 'object' || value === null || value[LOCK.versionField] !== 1) return { status: 'invalid' };
  const skills = value[LOCK.skillsField];
  if (typeof skills !== 'object' || skills === null || Array.isArray(skills)) return { status: 'invalid' };
  const entries: SkillsLockEntry[] = [];
  for (const [name, entry] of Object.entries(skills)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const hash = (entry as Record<string, unknown>)[LOCK.hashField];
    const sourceType = (entry as Record<string, unknown>).sourceType;
    if (typeof hash === 'string') entries.push({ name, computedHash: hash.toLowerCase(), sourceType: typeof sourceType === 'string' ? sourceType : '' });
  }
  return { status: 'ok', file: LOCK.file, entries };
}

/** Why an installed copy can differ from the hash taken at the source, when the folder shows it (D-009). */
export function falseMismatchReason(component: Component): string | undefined {
  const files = component.files ?? [];
  if (files.some((file) => file.link === true)) return 'it holds links, which the hash skips and the installer copies as files';
  if (files.some((file) => /(?:^|\/)(?:__pycache__|__pypackages__)\//.test(file.path))) return 'it holds __pycache__ or __pypackages__, which appear when its scripts run and the installer does not copy';
  if (files.some((file) => /(?:^|\/)metadata\.json$/.test(file.path))) return 'it holds metadata.json, which the installer does not copy';
  return undefined;
}
