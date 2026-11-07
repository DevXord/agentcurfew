import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
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
export function agentsOfFile(path: string, ignoreCase = false): string[] {
  const fold = (text: string): string => (ignoreCase ? text.toLowerCase() : text);
  if (OWN_FILES.some((own) => fold(own) === fold(path))) return ['agentcurfew'];
  const agents = new Set<string>();
  for (const known of knownPaths(knowledgeBase)) {
    const scope = path.startsWith('~/') ? 'user' : 'project';
    if (known.entry.scope === scope && globMatch(fold(known.entry.path), fold(path))) agents.add(known.agent.name);
  }
  return [...agents].sort();
}

// The file systems of Windows and macOS ignore letter case by default: there .CLAUDE/settings.json is .claude/settings.json.
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

function real(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/** The segments of an absolute path below base, or undefined when it is not below it. */
function below(base: string, absolute: string, ignoreCase: boolean): string[] | undefined {
  const inside = ignoreCase ? relative(base.toLowerCase(), absolute.toLowerCase()) : relative(base, absolute);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return undefined;
  return absolute.split(sep).slice(-inside.split(sep).length);
}

/**
 * Where a write lands: each folder and file that exists is spelled as it is on disk, and links are followed, so that a
 * write to docs/x.json that links to .claude/settings.json, or to .CLAUDE/settings.json on Windows or macOS, is seen
 * as a write to .claude/settings.json. Only the project and the home directory are walked; nothing is changed.
 */
export function writeTarget(file: string, root: string, home: string = homedir(), ignoreCase: boolean = CASE_INSENSITIVE): string {
  const absolute = isAbsolute(file) ? resolve(file) : resolve(root, file);
  for (const base of [root, home]) {
    const segments = below(base, absolute, ignoreCase);
    if (segments === undefined) continue;
    let current = real(base);
    let index = 0;
    for (; index < segments.length; index++) {
      const name = segments[index] ?? '';
      let names: string[];
      try {
        names = readdirSync(current);
      } catch {
        break;
      }
      const found = names.includes(name) ? name : ignoreCase ? names.find((candidate) => candidate.toLowerCase() === name.toLowerCase()) : undefined;
      if (found === undefined) break;
      current = join(current, found);
    }
    return join(real(current), ...segments.slice(index));
  }
  return absolute;
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
export function checkWrite(file: string, newText: string | { why: string }, root: string, now?: Date, home: string = homedir(), ignoreCase: boolean = CASE_INSENSITIVE): Verdict | undefined {
  // The file the write lands on, through links and letter case, when that is a file that steers an agent; else the path as given.
  const landed = knowledgePath(writeTarget(file, root, home, ignoreCase), real(root), real(home));
  const given = knowledgePath(file, root, home);
  const path = landed !== undefined && agentsOfFile(landed).length > 0 ? landed : given;
  if (path === undefined) return undefined;
  const agents = agentsOfFile(path);
  if (agents.length === 0) {
    // A folder that does not exist yet, spelled in another case, as .CLAUDE/skills/x/SKILL.md: the agent may read it.
    const folded = ignoreCase ? agentsOfFile(path, true) : [];
    if (folded.length === 0) return undefined;
    return { decision: 'ask', reasons: [`agentcurfew: ${quote(path, 120)} differs only in letter case from a file that steers ${folded.join(', ')}, and this file system ignores case, so the change could not be checked.`] };
  }
  const what = `${quote(path, 120)} steers ${agents.join(', ')}`;
  if (typeof newText !== 'string') return { decision: 'ask', reasons: [`agentcurfew: ${what}, and the change could not be checked: ${newText.why}.`] };
  // Text past the scanner's limit would be skipped, and the hook would see nothing in it: padding must not turn a deny into an ask.
  if (Buffer.byteLength(newText, 'utf8') > DEFAULT_LIMITS.maxFileBytes) return { decision: 'deny', reasons: [`agentcurfew: ${what}, and the new text is larger than the ${DEFAULT_LIMITS.maxFileBytes} bytes agentcurfew reads, so it cannot be checked.`] };
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
  const known = new Set(before.inventory.problems.map((problem) => `${problem.code}\0${problem.file}`));
  const problem = after.inventory.problems.find((item) => item.file === path && !known.has(`${item.code}\0${item.file}`));
  if (problem !== undefined && problem.code !== 'unparsable') return { decision: 'deny', reasons: [`agentcurfew: ${what}, and agentcurfew could not read the new text (${problem.code}), so it cannot be checked.`] };
  const seen = new Set(before.findings.map(key));
  const added = after.findings.filter((finding) => !IGNORED_RULES.has(finding.rule) && concerns(finding, path) && !seen.has(key(finding)));
  const serious = added.filter((finding) => atLeast(finding.level, 'high') || finding.rule === 'out-of-policy');
  const describe = (finding: Finding) => `${finding.rule} (${finding.level}) in ${quote(finding.file, 80)}: ${finding.message}`;
  if (serious.length > 0) return { decision: 'deny', reasons: [`agentcurfew: ${what}, and the change would add: ${serious.map(describe).join('; ')}.`] };
  const minor = problem !== undefined ? ' agentcurfew could not parse the new text, so the rules did not check it.' : added.length > 0 ? ` It would add: ${added.map(describe).join('; ')}.` : ' The rules found nothing new in it.';
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
