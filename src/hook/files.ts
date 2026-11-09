import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
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

const MAX_LINKS = 40;
const SEPARATORS = sep === '\\' ? /[\\/]+/ : /\/+/;

/**
 * The path a write to an absolute path lands on, as the file system resolves it: every link on the way is read, the
 * last one too even when its target does not exist yet (the write creates it), and .. is applied after the link before
 * it, so a/link/../x lands next to the link's target. Nothing is created or followed out of curiosity: links are read
 * with readlink only.
 */
export function physicalPath(path: string): string {
  const top = parse(path).root;
  let current = top;
  const pending = path.slice(top.length).split(SEPARATORS).filter((part) => part !== '');
  let links = 0;
  while (pending.length > 0) {
    const name = pending.shift() as string;
    if (name === '.') continue;
    if (name === '..') {
      current = dirname(current);
      continue;
    }
    const next = join(current, name);
    let link = false;
    try {
      link = lstatSync(next).isSymbolicLink();
    } catch {
      // Not there yet: the rest is created as written.
    }
    if (link && links < MAX_LINKS) {
      links++;
      let target: string;
      try {
        target = readlinkSync(next);
      } catch {
        current = next;
        continue;
      }
      const targetTop = isAbsolute(target) ? parse(target).root : '';
      if (targetTop !== '') current = targetTop;
      pending.unshift(...target.slice(targetTop.length).split(SEPARATORS).filter((part) => part !== ''));
      continue;
    }
    current = next;
  }
  return current;
}

/**
 * Where a write lands: links are followed as the file system does (physicalPath), and each folder and file that exists
 * is spelled as it is on disk, so that a write to docs/x.json that links to .claude/settings.json, or to
 * .CLAUDE/settings.json on Windows or macOS, is seen as a write to .claude/settings.json. Only the project and the home
 * directory are listed; nothing is changed. An NTFS ::$DATA suffix names the file itself and is dropped.
 */
export function writeTarget(file: string, root: string, home: string = homedir(), ignoreCase: boolean = CASE_INSENSITIVE): string {
  const plain = file.replace(/:+\$DATA$/i, '');
  // Not resolve(): it would apply .. before the links are read.
  const absolute = physicalPath(isAbsolute(plain) ? plain : `${root}${sep}${plain}`);
  for (const base of [real(root), real(home), root, home]) {
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
  return real(absolute);
}

/**
 * The path of the knowledge base that a landed file is reached by, when that path runs through a link: a write to
 * config/s.json where .claude/settings.json links to it is a write to .claude/settings.json. Each project path is
 * resolved up to its first wildcard, and the rest is matched as a glob.
 */
function linkedKnowledgePath(landed: string, root: string, ignoreCase: boolean): string | undefined {
  const fold = (text: string): string => (ignoreCase ? text.toLowerCase() : text);
  const patterns = [...OWN_FILES, ...knownPaths(knowledgeBase).filter((known) => known.entry.scope === 'project').map((known) => known.entry.path)];
  for (const pattern of patterns) {
    const parts = pattern.split('/');
    const wild = parts.findIndex((part) => /[*?]/.test(part));
    const prefix = (wild === -1 ? parts : parts.slice(0, wild)).join('/');
    if (prefix === '') continue;
    const resolved = real(physicalPath(`${root}${sep}${prefix.split('/').join(sep)}`));
    const inside = relative(fold(resolved), fold(landed));
    if (inside.startsWith('..') || isAbsolute(inside)) continue;
    const rest = inside === '' ? [] : landed.split(sep).slice(-inside.split(sep).length);
    const candidate = [prefix, ...rest].join('/');
    if (globMatch(pattern, candidate)) return candidate;
  }
  return undefined;
}

/** A path spelled in the letter case of the knowledge base, where a pattern matches it ignoring case and has no **. */
function knowledgeCase(path: string): string | undefined {
  for (const pattern of [...OWN_FILES, ...knownPaths(knowledgeBase).filter((known) => known.entry.scope === 'project').map((known) => known.entry.path)]) {
    if (pattern.includes('**') || !globMatch(pattern.toLowerCase(), path.toLowerCase())) continue;
    const parts = path.split('/');
    const literal = pattern.split('/');
    // A pattern that names a folder also matches everything below it; segments past the pattern keep their case.
    const spelled = parts.map((part, index) => (literal[index] !== undefined && !/[*?]/.test(literal[index]) ? literal[index] : part)).join('/');
    if (agentsOfFile(spelled).length > 0) return spelled;
  }
  return undefined;
}

function key(finding: Finding): string {
  // By id, so a finding of a hook that only moved, because one was added before it, is not taken for a new one (D-042).
  return [finding.rule, finding.kind, finding.file, finding.componentId ?? finding.name, finding.message].join('\0');
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
export function checkWrite(file: string, newText: string | { why: string; deny?: boolean }, root: string, now?: Date, home: string = homedir(), ignoreCase: boolean = CASE_INSENSITIVE): Verdict | undefined {
  // The file the write lands on, through links and letter case, when that is a file that steers an agent; else the path as given.
  const target = writeTarget(file, root, home, ignoreCase);
  const realRoot = real(root);
  const candidates = [knowledgePath(target, realRoot, real(home)), linkedKnowledgePath(target, realRoot, ignoreCase), knowledgePath(file.replace(/:+\$DATA$/i, ''), root, home)];
  let path = candidates.find((candidate) => candidate !== undefined && agentsOfFile(candidate).length > 0) ?? candidates.find((candidate) => candidate !== undefined);
  if (path === undefined) return undefined;
  if (agentsOfFile(path).length === 0 && ignoreCase) {
    // A folder that does not exist yet, spelled in another case, as .CLAUDE/skills/x/SKILL.md: check it as the agent reads it.
    const spelled = knowledgeCase(path);
    if (spelled === undefined && agentsOfFile(path, true).length > 0) return { decision: 'ask', reasons: [`agentcurfew: ${quote(path, 120)} differs only in letter case from a file that steers ${agentsOfFile(path, true).join(', ')}, and this file system ignores case, so the change could not be checked.`] };
    path = spelled ?? path;
  }
  const agents = agentsOfFile(path);
  if (agents.length === 0) return undefined;
  const what = `${quote(path, 120)} steers ${agents.join(', ')}`;
  if (typeof newText !== 'string') return { decision: newText.deny === true ? 'deny' : 'ask', reasons: [`agentcurfew: ${what}, and the change could not be checked: ${newText.why}.`] };
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
  // Any place the scanner could not read on the way to the new text means the text was not checked: too large, too
  // deep, a link out of the project in a folder above it, or text agentcurfew cannot parse (an agent may still load it,
  // for example JSON nested deeper than the parser goes). It counts even when the old file had the same problem.
  const problem = after.inventory.problems.find((item) => item.file === path || path.startsWith(`${item.file}/`));
  if (problem !== undefined) return { decision: 'deny', reasons: [`agentcurfew: ${what}, and agentcurfew could not read the new text (${problem.code}${problem.file === path ? '' : ` at ${quote(problem.file, 80)}`}), so it cannot be checked.`] };
  const seen = new Set(before.findings.map(key));
  const added = after.findings.filter((finding) => !IGNORED_RULES.has(finding.rule) && concerns(finding, path) && !seen.has(key(finding)));
  const serious = added.filter((finding) => atLeast(finding.level, 'high') || finding.rule === 'out-of-policy');
  const describe = (finding: Finding) => `${finding.rule} (${finding.level}) in ${quote(finding.file, 80)}: ${finding.message}`;
  if (serious.length > 0) return { decision: 'deny', reasons: [`agentcurfew: ${what}, and the change would add: ${serious.map(describe).join('; ')}.`] };
  const minor = added.length > 0 ? ` It would add: ${added.map(describe).join('; ')}.` : ' The rules found nothing new in it.';
  return { decision: 'ask', reasons: [`agentcurfew: ${what}.${minor}`] };
}

/** What readCurrent returns for a file over the read limit. */
export const TOO_LARGE = Symbol('too large');

export function readCurrent(file: string, root: string): string | typeof TOO_LARGE | undefined {
  try {
    const path = isAbsolute(file) ? file : resolve(root, file);
    if (statSync(path).size > DEFAULT_LIMITS.maxFileBytes) return TOO_LARGE;
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}
