import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { analyzeProject } from '../analyze.ts';
import { knownPaths } from '../doctor/paths.ts';
import { DEFAULT_LIMITS } from '../inventory/files.ts';
import { knowledgeBase } from '../knowledge/index.ts';
import { LOCKFILE } from '../lock/types.ts';
import { globMatch } from '../policy/glob.ts';
import { POLICY_FILE } from '../policy/types.ts';
import { validatePolicy } from '../policy/validate.ts';
import { parseConfig } from '../inventory/parse.ts';
import { quote } from '../rules/mask.ts';
import { atLeast } from '../rules/index.ts';
import type { Finding } from '../rules/types.ts';
import type { Verdict } from './types.ts';

// Files that steer agentcurfew itself: an agent that rewrites them can switch the checks off.
const OWN_FILES = [POLICY_FILE, LOCKFILE, 'skills-lock.json'];
// Rules about the difference between the project and its locks: any write makes them fire, so they say nothing here.
const IGNORED_RULES = new Set(['drift', 'skills-lock-mismatch']);

/** The path as the knowledge base writes it: relative to the project, or starting with ~/ for the home directory. */
export function knowledgePath(file: string, root: string, home: string = homedir()): string | undefined {
  const absolute = isAbsolute(file) ? file : resolve(root, file);
  const inProject = relative(root, absolute);
  if (inProject !== '' && !inProject.startsWith('..') && !isAbsolute(inProject)) return inProject.split(sep).join('/');
  const inHome = relative(home, absolute);
  if (inHome !== '' && !inHome.startsWith('..') && !isAbsolute(inHome)) return `~/${inHome.split(sep).join('/')}`;
  return undefined;
}

/** The agents that read a file, by the paths of the knowledge base; agentcurfew's own files count as well. */
export function agentsOfFile(path: string): string[] {
  if (OWN_FILES.includes(path)) return ['agentcurfew'];
  const agents = new Set<string>();
  for (const known of knownPaths(knowledgeBase)) {
    const scope = path.startsWith('~/') ? 'user' : 'project';
    if (known.entry.scope === scope && globMatch(known.entry.path, path)) agents.add(known.agent.name);
  }
  return [...agents].sort();
}

function key(finding: Finding): string {
  return [finding.rule, finding.kind, finding.file, finding.name, finding.message].join('\0');
}

function concerns(finding: Finding, path: string): boolean {
  if (finding.file === path) return true;
  const folder = finding.file.slice(0, finding.file.lastIndexOf('/') + 1);
  return finding.kind === 'skill' && folder !== '' && path.startsWith(folder);
}

/** The text a file will hold after an edit, or why it cannot be known. */
export function afterEdit(current: string | undefined, oldText: string, newText: string, all: boolean): { text: string } | { why: string } {
  if (current === undefined) return { why: 'the file could not be read' };
  if (oldText === '') return { why: 'the edit names no text to replace' };
  const at = current.indexOf(oldText);
  if (at === -1) return { why: 'the text to replace is not in the file' };
  return { text: all ? current.split(oldText).join(newText) : current.slice(0, at) + newText + current.slice(at + oldText.length) };
}

/**
 * A write to a file that steers an agent: ask, with the agents it steers; deny when the new text brings a finding at high
 * or above, or one out of the policy. The new text is scanned as an overlay, so nothing is written to check it.
 */
export function checkWrite(file: string, newText: string | { why: string }, root: string, now?: Date, home: string = homedir()): Verdict | undefined {
  const path = knowledgePath(file, root, home);
  if (path === undefined) return undefined;
  const agents = agentsOfFile(path);
  if (agents.length === 0) return undefined;
  const what = `${quote(path, 120)} steers ${agents.join(', ')}`;
  if (typeof newText !== 'string') return { decision: 'ask', reasons: [`agentcurfew: ${what}, and the change could not be checked: ${newText.why}.`] };
  if (path.startsWith('~/')) return { decision: 'ask', reasons: [`agentcurfew: ${what}, in your user settings, which apply to every project.`] };
  if (path === POLICY_FILE) {
    // The policy is read from disk, not through the overlay, so the new text is checked here.
    const value = parseConfig(newText, 'json');
    const issues = value === undefined ? [{ path: 'policy', message: 'the file is not valid JSON' }] : validatePolicy(value).issues;
    const first = issues[0];
    if (first !== undefined) return { decision: 'deny', reasons: [`agentcurfew: the new ${POLICY_FILE} does not follow the schema: ${quote(first.path, 80)}: ${first.message}.`] };
    return { decision: 'ask', reasons: [`agentcurfew: ${what}: this changes what agentcurfew allows.`] };
  }
  const options = now === undefined ? {} : { now };
  const before = analyzeProject(root, options);
  const after = analyzeProject(root, { ...options, overlay: new Map([[path, newText]]) });
  const seen = new Set(before.findings.map(key));
  const added = after.findings.filter((finding) => !IGNORED_RULES.has(finding.rule) && concerns(finding, path) && !seen.has(key(finding)));
  const serious = added.filter((finding) => atLeast(finding.level, 'high') || finding.rule === 'out-of-policy');
  const describe = (finding: Finding) => `${finding.rule} (${finding.level}) in ${quote(finding.file, 80)}: ${finding.message}`;
  if (serious.length > 0) return { decision: 'deny', reasons: [`agentcurfew: ${what}, and the change would add: ${serious.map(describe).join('; ')}.`] };
  const minor = added.length > 0 ? ` It would add: ${added.map(describe).join('; ')}.` : ' The rules found nothing new in it.';
  return { decision: 'ask', reasons: [`agentcurfew: ${what}.${minor}`] };
}

export function readCurrent(file: string, root: string): string | undefined {
  try {
    const path = isAbsolute(file) ? file : resolve(root, file);
    if (statSync(path).size > DEFAULT_LIMITS.maxFileBytes) return undefined;
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}
