import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_LIMITS } from '../inventory/files.ts';
import { parseConfig } from '../inventory/parse.ts';
import type { Policy, PolicyIssue } from './types.ts';
import { POLICY_FILE } from './types.ts';
import { validatePolicy } from './validate.ts';

export type PolicyRead = { status: 'missing' } | { status: 'invalid'; issues: PolicyIssue[] } | { status: 'ok'; policy: Policy };

/** agentcurfew.policy.json of a project, read like every other untrusted file and checked against schema.json. */
export function readPolicy(root: string, maxBytes = DEFAULT_LIMITS.maxFileBytes): PolicyRead {
  const path = join(root, POLICY_FILE);
  let text: string;
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return { status: 'invalid', issues: [{ path: 'policy', message: 'the file is a link, which is not followed' }] };
    if (!stat.isFile()) return { status: 'invalid', issues: [{ path: 'policy', message: 'it is not a file' }] };
    if (stat.size > maxBytes) return { status: 'invalid', issues: [{ path: 'policy', message: 'the file is over the size limit' }] };
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    return { status: 'invalid', issues: [{ path: 'policy', message: 'the file could not be read' }] };
  }
  const value = parseConfig(text, 'json');
  if (value === undefined) return { status: 'invalid', issues: [{ path: 'policy', message: 'the file is not valid JSON' }] };
  const result = validatePolicy(value);
  return 'policy' in result ? { status: 'ok', policy: result.policy } : { status: 'invalid', issues: result.issues };
}
