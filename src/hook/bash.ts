import { parseArgs } from 'node:util';
import type { Component } from '../inventory/types.ts';
import { knowledgeBase } from '../knowledge/index.ts';
import { shared } from '../knowledge/shared.ts';
import type { AgentKnowledge, CliOption, Fact, McpAddKnowledge, SkillsInstallerKnowledge } from '../knowledge/types.ts';
import { serverIdentity } from '../lock/build.ts';
import { LOCKFILE } from '../lock/types.ts';
import { redact } from '../lock/redact.ts';
import { POLICY_FILE } from '../policy/types.ts';
import type { Policy } from '../policy/types.ts';
import { agentFileNames, agentFilePattern, agentFolders, escapeRegExp } from '../rules/agent-files.ts';
import { atLeast, runRules } from '../rules/index.ts';
import { launchedCommand, packageName } from '../rules/launch.ts';
import { quote } from '../rules/mask.ts';
import { allowedBy } from '../rules/rules/out-of-policy.ts';
import { writesTo } from '../rules/shell.ts';
import type { Matcher } from '../rules/shell.ts';
import type { Verdict } from './types.ts';

import { commands, unwrapCommand } from '../rules/command-words.ts';
import type { Dialect } from '../rules/command-words.ts';

export { commands };

function value<T>(fact: Fact<T>): T {
  return fact.status === 'disputed' ? fact.variants[0].value : fact.value;
}

/** The program a word runs: its base name, lowercase, without .cmd, .exe, .bat or .ps1 (npx.cmd, /usr/bin/npx, claude.exe). */
function program(word: string): string {
  return (word.split(/[\\/]/).at(-1) ?? '').toLowerCase().replace(/\.(?:cmd|exe|bat|ps1)$/, '');
}

// The words that start a launcher, for the hook's search of installs behind wrappers it does not know.
const LAUNCHER_WORDS = ['npx', 'pnpx', 'bunx', 'pnpm', 'yarn', 'npm', 'bun', ...Object.keys(value(shared.packageAliases).aliases)];

/** The positional words of a command line, parsed as the skills CLI parses them (node:util parseArgs, list options). */
function positionals(args: readonly string[], spec: Readonly<Record<string, CliOption>>): string[] | undefined {
  let tokens;
  try {
    ({ tokens } = parseArgs({
      args: [...args],
      options: Object.fromEntries(Object.entries(spec).map(([name, option]) => [name, { type: option.type === 'boolean' ? 'boolean' : 'string', ...(option.short === undefined ? {} : { short: option.short }) }])),
      strict: false,
      allowPositionals: true,
      tokens: true,
    }));
  } catch {
    return undefined;
  }
  const found: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (token.kind === 'positional') {
      if (token.value !== '') found.push(token.value);
      continue;
    }
    if (token.kind !== 'option' || !Object.hasOwn(spec, token.name) || spec[token.name]?.type !== 'list' || token.inlineValue === true) continue;
    // A list option takes the positional words after its value, up to the next option.
    while (tokens[index + 1]?.kind === 'positional') index++;
  }
  return found;
}

/** What a skills CLI command does: installs from sources, changes the installed skills, or adds from a source not told. */
export type SkillsCall = { kind: 'install'; command: string; sources: string[] } | { kind: 'change'; command: string } | { kind: 'unclear'; command: string };

/** The skills CLI run directly or through any launcher, and what its command does; undefined for any other command. */
export function skillsCall(words: readonly string[]): SkillsCall | undefined {
  const installer: SkillsInstallerKnowledge = value(shared.skillsInstaller);
  let args: readonly string[];
  if (installer.binaries.includes(program(words[0] ?? ''))) {
    args = words.slice(1);
  } else {
    const launched = launchedCommand(words);
    if (launched === undefined) return undefined;
    const isInstaller = (spec: string) => packageName(spec) === installer.packageName;
    if (!launched.packages.some(isInstaller) || !(isInstaller(launched.command) || installer.binaries.includes(launched.command))) return undefined;
    args = launched.args;
  }
  if (args[0] === '--') args = args.slice(1);
  const command = args[0];
  if (command === undefined) return undefined;
  const rest = args.slice(1);
  if (command === installer.addCommand || installer.addAliases.includes(command) || command === installer.useCommand) {
    const sources = positionals(rest, command === installer.useCommand ? installer.useOptions : installer.addOptions);
    if (sources === undefined) return { kind: 'unclear', command };
    if (sources.length > 0) return { kind: 'install', command, sources };
    return installer.restoreWithoutSource.includes(command) ? { kind: 'change', command } : { kind: 'unclear', command };
  }
  return installer.changeCommands.includes(command) ? { kind: 'change', command } : undefined;
}

/** The first source of `npx skills add <source>` and its variants, or undefined. */
export function skillsSource(words: readonly string[]): string | undefined {
  const call = skillsCall(words);
  return call?.kind === 'install' ? call.sources[0] : undefined;
}

function mcpAddFacts(): { agent: AgentKnowledge; mcpAdd: McpAddKnowledge }[] {
  return knowledgeBase.flatMap((agent) => (agent.mcpAdd === undefined ? [] : (agent.mcpAdd.status === 'disputed' ? agent.mcpAdd.variants.map((variant) => variant.value) : [agent.mcpAdd.value]).map((mcpAdd) => ({ agent, mcpAdd }))));
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The server an `<agent> mcp add` or `add-json` command would add, as an entry of .mcp.json, or undefined. */
export function addedServer(words: readonly string[]): { agent: AgentKnowledge; name: string; entry: Record<string, unknown> } | undefined {
  for (const { agent, mcpAdd } of mcpAddFacts()) {
    const starts = (command: readonly string[]) => program(words[0] ?? '') === command[0] && command.slice(1).every((part, index) => words[index + 1] === part);
    const json = starts(mcpAdd.jsonCommand);
    const plain = !json && starts(mcpAdd.command);
    if (!json && !plain) continue;
    const rest = words.slice((json ? mcpAdd.jsonCommand : mcpAdd.command).length);
    const separator = rest.indexOf(mcpAdd.separator);
    const head = separator === -1 ? rest : rest.slice(0, separator);
    const positional: string[] = [];
    let transport = 'stdio';
    // -e KEY=VALUE and -H "Name: value" become the server's env and headers, so a secret in them is checked like one
    // written into .mcp.json; --env takes every KEY=value after it.
    const env: Record<string, string> = {};
    const headers: Record<string, string> = {};
    const take = (option: string, given: string) => {
      if ((option === '--transport' || option === '-t') && given !== '') transport = given;
      if ((option === '-e' || option === '--env') && given.includes('=')) env[given.slice(0, given.indexOf('='))] = given.slice(given.indexOf('=') + 1);
      if ((option === '-H' || option === '--header') && given.includes(':')) headers[given.slice(0, given.indexOf(':')).trim()] = given.slice(given.indexOf(':') + 1).trim();
    };
    for (let index = 0; index < head.length; index++) {
      const word = head[index] as string;
      const [option, inline] = word.startsWith('--') && word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined];
      if (mcpAdd.valueOptions.includes(option)) {
        if (inline !== undefined) {
          take(option, inline);
          continue;
        }
        take(option, head[index + 1] ?? '');
        index++;
        if (mcpAdd.multiValueOptions?.includes(option) === true) {
          while (head[index + 1] !== undefined && ASSIGNMENT.test(head[index + 1] as string)) take(option, head[++index] as string);
        }
      } else if (!word.startsWith('-')) {
        positional.push(word);
      }
    }
    const name = positional[0] ?? '';
    if (json) {
      try {
        const parsed = JSON.parse(positional[1] ?? '') as unknown;
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return { agent, name, entry: parsed as Record<string, unknown> };
      } catch {
        return { agent, name, entry: {} };
      }
      return { agent, name, entry: {} };
    }
    if (transport === 'http' || transport === 'sse') return { agent, name, entry: { type: transport, url: positional[1] ?? '', headers } };
    const command = separator === -1 ? positional.slice(1) : rest.slice(separator + 1);
    return { agent, name, entry: { command: command[0] ?? '', args: command.slice(1), env } };
  }
  return undefined;
}

/** A word of a command line made safe for a reason the agent reads: secrets redacted, then quoted. */
function shown(text: string, max: number): string {
  return quote(redact(text), max);
}

function isLocalSource(source: string): boolean {
  return /^(?:\.{0,2}\/|[A-Za-z]:[\\/]|~\/)/.test(source);
}

function checkSkills(call: SkillsCall, policy: Policy | undefined, line: string): Verdict {
  if (call.kind === 'change') return { decision: 'ask', reasons: [`agentcurfew: this command (skills ${shown(call.command, 40)}) changes the installed skills, which can bring new instructions and scripts the agent will follow; check them with agentcurfew scan afterwards.`] };
  if (call.kind === 'unclear') return { decision: 'ask', reasons: [`agentcurfew: agentcurfew cannot tell which source this skills ${shown(call.command, 40)} command installs from (${shown(line, 120)}).`] };
  const sources = policy?.skills?.allowSources;
  if (sources !== undefined) {
    const denied = call.sources.filter((source) => (isLocalSource(source) ? !sources.includes('local') : !allowedBy(sources, source)));
    if (denied.length > 0) return { decision: 'deny', reasons: [`agentcurfew: the skill source ${denied.map((source) => shown(source, 100)).join(', ')} is not in skills.allowSources of agentcurfew.policy.json.`] };
  }
  const named = call.sources.map((source) => shown(source, 100)).join(', ');
  return { decision: 'ask', reasons: [`agentcurfew: this installs the skill ${named}, which can bring instructions and scripts the agent will follow; check it first with the MCP tool check_skill or agentcurfew scan.`] };
}

function checkMcpAdd(added: NonNullable<ReturnType<typeof addedServer>>, policy: Policy | undefined): Verdict {
  const component: Component = { kind: 'mcp-server', agents: [added.agent.id], scope: 'project', file: '.mcp.json', name: added.name, raw: JSON.stringify(added.entry) };
  const name = shown(added.name, 60);
  const reasons: string[] = [];
  const servers = policy?.mcp?.allowServers;
  if (servers !== undefined) {
    const { names, local } = serverIdentity(component);
    const allowed = local ? servers.includes('local') : names.length > 0 && names.some((identity) => allowedBy(servers, identity));
    if (!allowed) reasons.push(`the MCP server ${name} (${names.map((identity) => quote(identity, 80)).join(', ') || 'a local command'}) is not in mcp.allowServers of agentcurfew.policy.json`);
  }
  const findings = runRules({ components: [component], problems: [] }).filter((finding) => finding.rule !== 'out-of-policy');
  const serious = findings.filter((finding) => atLeast(finding.level, 'high'));
  reasons.push(...serious.map((finding) => `${finding.rule}: ${finding.message}`));
  if (reasons.length > 0) return { decision: 'deny', reasons: [`agentcurfew: ${reasons.join('; ')}.`] };
  const notes = findings.map((finding) => ` ${finding.rule}: ${finding.message}.`).join('');
  return { decision: 'ask', reasons: [`agentcurfew: this adds the MCP server ${name} to ${added.agent.name}.${notes}`] };
}

// agentcurfew's own files and depcurfew's, which a command that writes or removes them can use to switch a check off.
const OWN_FILES = [POLICY_FILE, LOCKFILE, 'skills-lock.json', 'depcurfew.json'];
const GUARDS = ['agentcurfew', 'depcurfew'] as const;
// The folders of the installed guards: the hooks run the code in them.
function guardFolders(): string[] {
  const entries = value(shared.depcurfew).entryFiles.map((file) => file.replace(/\/dist\/cli\.js$/, ''));
  return [...new Set(['node_modules/agentcurfew', ...entries])];
}

/** Which guard a command runs, and its arguments: the binary, node with the guard's cli.js, or a launcher of its package. */
function guardRun(words: readonly string[]): { guard: (typeof GUARDS)[number]; args: readonly string[] } | undefined {
  const first = program(words[0] ?? '');
  if (first === 'agentcurfew' || first === 'acf') return { guard: 'agentcurfew', args: words.slice(1) };
  if (first === 'depcurfew' || first === 'dcf') return { guard: 'depcurfew', args: words.slice(1) };
  if (first === 'node') {
    const file = (words[1] ?? '').replaceAll('\\', '/');
    for (const guard of GUARDS) if (file.endsWith(`node_modules/${guard}/dist/cli.js`)) return { guard, args: words.slice(2) };
    return undefined;
  }
  const launched = launchedCommand(words);
  if (launched === undefined) return undefined;
  for (const guard of GUARDS) if (launched.packages.some((spec) => packageName(spec) === guard) && packageName(launched.command) === guard) return { guard, args: launched.args };
  return undefined;
}

/** The files a guard's command writes, when it is one that writes configuration; undefined when it only reads. */
function guardWrites(run: { guard: (typeof GUARDS)[number]; args: readonly string[] }): string[] | undefined {
  const command = run.args.find((arg) => !arg.startsWith('-'));
  if (run.guard === 'depcurfew') return command !== undefined && value(shared.depcurfew).writingCommands.includes(command) ? ['depcurfew.json and the configuration of the package managers'] : undefined;
  if (command === 'lock') return [LOCKFILE];
  if (command === 'init') return run.args.includes('--hook') ? ['.claude/settings.json'] : [POLICY_FILE];
  return undefined;
}

/** A package manager removing agentcurfew or depcurfew: npm uninstall, pnpm remove, yarn remove, bun rm and the like. */
function removesGuard(words: readonly string[]): string | undefined {
  const removal = value(shared.packageRemoval);
  const aliases = value(shared.packageAliases).aliases;
  const name = program(words[0] ?? '');
  const tool = Object.hasOwn(aliases, name) ? (aliases[name]?.[0] ?? name) : name;
  const subcommands = Object.hasOwn(removal.commands, tool) ? removal.commands[tool] : undefined;
  if (subcommands === undefined) return undefined;
  const at = words.findIndex((word, index) => index > 0 && !word.startsWith('-'));
  const sub = words[at] ?? '';
  // npm takes any unique start of a command name: uninst is uninstall.
  const abbreviated = removal.abbreviates.includes(tool) && sub.length >= 3 && subcommands.some((command) => command.length > sub.length && command.startsWith(sub));
  if (!subcommands.includes(sub) && !abbreviated) return undefined;
  return words.slice(at + 1).map((word) => packageName(word)).find((word): word is (typeof GUARDS)[number] => (GUARDS as readonly string[]).includes(word));
}

/** Commands that touch the guards: removing their package, or running agentcurfew or depcurfew to rewrite configuration. */
function checkGuardCommand(words: readonly string[]): Verdict | undefined {
  const removed = removesGuard(words);
  if (removed !== undefined) return { decision: 'ask', reasons: [`agentcurfew: this removes ${removed}, whose hook checks the agent's ${removed === 'depcurfew' ? 'installs' : 'writes to the files that steer it'}.`] };
  const run = guardRun(words);
  const writes = run === undefined ? undefined : guardWrites(run);
  if (run !== undefined && writes !== undefined) return { decision: 'ask', reasons: [`agentcurfew: this runs ${run.guard} to write ${writes.join(', ')}, which changes what ${run.guard} checks.`] };
  return undefined;
}

let writePattern: Matcher | undefined;
const MAX_STARTS = 32;
let starters: ReadonlySet<string> | undefined;

/** The programs an install command can begin with: launchers, the skills CLI and the agents' mcp add commands. */
function firstWords(): ReadonlySet<string> {
  starters ??= new Set([...LAUNCHER_WORDS, ...value(shared.skillsInstaller).binaries, ...mcpAddFacts().flatMap(({ mcpAdd }) => [mcpAdd.command[0], mcpAdd.jsonCommand[0]]).filter((word): word is string => word !== undefined)]);
  return starters;
}

/** A shell command line: skills and MCP servers being added, the guards being changed, and writes to the files that steer agents. */
export function checkCommand(line: string, policy: Policy | undefined, dialect: Dialect = 'sh'): Verdict[] {
  const verdicts: Verdict[] = [];
  // Each command with its wrappers taken off: CI=1 npx skills add, (npx skills add) and bash -c "npx skills add" are checked alike.
  // A wrapper agentcurfew does not know may still run the install with the words after it, so every word that can begin
  // one is tried; at most MAX_STARTS of them, since each try reads the rest of the command.
  const first = firstWords();
  let tries = 0;
  for (const words of commands(line, dialect).flatMap((command) => unwrapCommand(command))) {
    const guard = checkGuardCommand(words);
    if (guard !== undefined) verdicts.push(guard);
    for (let start = 0; start < words.length; start++) {
      // The first word of each command is always tried, which reads each word once; only later starts count.
      if (start > 0 && !first.has(program(words[start] ?? ''))) continue;
      if (start > 0 && ++tries > MAX_STARTS) {
        verdicts.push({ decision: 'ask', reasons: ['agentcurfew: this command line is too long and repetitive to check for installs of skills and MCP servers.'] });
        return verdicts;
      }
      const rest = words.slice(start);
      const skills = skillsCall(rest);
      const added = skills === undefined ? addedServer(rest) : undefined;
      if (skills !== undefined) verdicts.push(checkSkills(skills, policy, rest.join(' ')));
      if (added !== undefined) verdicts.push(checkMcpAdd(added, policy));
      if (skills !== undefined || added !== undefined) break;
    }
  }
  writePattern ??= writesTo(`(?:${agentFilePattern(knowledgeBase)}|${OWN_FILES.map(escapeRegExp).join('|')})`);
  if (writePattern.test(line)) {
    verdicts.push({ decision: 'ask', reasons: ['agentcurfew: this command writes to a file that steers an agent, and its new content cannot be checked before it runs.'] });
    return verdicts;
  }
  const named = namedAgentFile(line, dialect);
  if (named !== undefined) verdicts.push({ decision: 'ask', reasons: [`agentcurfew: this command names ${quote(named, 80)}, which steers an agent or guards it, and agentcurfew cannot tell from the command whether it changes it.`] });
  return verdicts;
}

// Commands that only read the files they name. Anything else that names an agent file may write it: curl -o, dd of=,
// python -c, perl -pi, git checkout --, unzip, install and many more, so asking is the safe answer. PowerShell's cmdlets
// that only read come from the knowledge base.
const READ_ONLY = new Set(['cat', 'less', 'more', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'wc', 'diff', 'cmp', 'ls', 'stat', 'file', 'md5sum', 'sha1sum', 'sha256sum', 'bat', 'jq', 'echo', 'printf', 'test', '[', 'realpath', 'readlink', 'dirname', 'basename', 'code', 'open', 'cd', 'pushd', 'popd', 'pwd', 'which', 'type', 'du', 'od', 'hexdump', 'strings', 'cut', 'nl', 'column', ...value(shared.powershell).readOnlyCommands]);
const GIT_READ_ONLY = new Set(['diff', 'log', 'show', 'status', 'blame', 'ls-files', 'grep', 'add', 'commit', 'reset']);
const FIND_WRITES = /^-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/;
// sed edits in place with -i, alone or in a group of short options (-Ei, -ni), or --in-place.
const SED_IN_PLACE = /^(?:-[A-Za-z]*i|--in-place)/;
// A redirection word: >, >>, >|, 1>, 2>>, &>, PowerShell's *> and the like, alone or with its target joined to it.
const REDIRECT = /^[0-9&*]*>{1,2}[|&]?(.*)$/;
let mentionPattern: RegExp | undefined;

function readOnly(words: readonly string[]): boolean {
  const name = program(words[0] ?? '');
  if (name === 'git') return GIT_READ_ONLY.has(words.find((word, index) => index > 0 && !word.startsWith('-')) ?? '');
  if (name === 'find') return !words.some((word) => FIND_WRITES.test(word));
  if (name === 'sed') return !words.some((word) => SED_IN_PLACE.test(word));
  // agentcurfew and depcurfew only read, except the commands that write configuration, which checkGuardCommand asks about.
  const run = guardRun(words);
  if (run !== undefined) return true;
  return READ_ONLY.has(name);
}

function names(): string[] {
  return [...agentFileNames(knowledgeBase).filter((name) => /[./]/.test(name)), ...OWN_FILES];
}

/** A word as a path with / separators: PowerShell, cmd and Windows paths use \. */
function slashed(word: string): string {
  return word.replaceAll('\\', '/');
}

/** The first agent file a command names, when the command is not known to only read it; redirections always count. */
function namedAgentFile(line: string, dialect: Dialect): string | undefined {
  // Only names that look like a file or folder of their own (with a dot or a slash) count: a bare word such as Rules,
  // the name of Cline's rules folder, appears in ordinary paths like src/rules/.
  // A file name must end where the word does; a folder may be followed by a slash and anything in it.
  const files = names().map(escapeRegExp);
  const folders = [...agentFolders(knowledgeBase).map((folder) => folder.replace(/\/$/, '')), ...guardFolders()].map(escapeRegExp);
  mentionPattern ??= new RegExp(`(?:^|[^\\w.-])((?:${files.join('|')})(?![\\w-]|\\.\\w)|(?:${folders.join('|')})(?:/|(?![\\w.-])))`, 'i');
  let globbed = 0;
  for (const word of checkedWords(line, dialect)) {
    const path = slashed(word);
    const match = mentionPattern.exec(path);
    if (match !== null) return match[1];
    const folder = rootFolderOf(path);
    if (folder !== undefined) return folder;
    // A glob or braces the shell expands into an agent file or folder: CLAUD?.md, .claude/settings.jso{n,x}, .c*e/
    // (review of 2026-11-09 and 2026-11-10).
    if (GLOB.test(path) && globbed++ < MAX_GLOB_WORDS) {
      const named = globbedAgentFile(path, names());
      if (named !== undefined) return named;
    }
  }
  return undefined;
}

/** The agent folder a path ends in, ignoring case: .claude, ./.CLAUDE/, ~/.claude, /abs/project/.claude. */
function rootFolderOf(path: string): string | undefined {
  const last = path.replace(/(?:\/+\.?)+$/, '').split('/').at(-1)?.toLowerCase();
  return last === undefined || last === '' ? undefined : agentRootFolders().find((folder) => folder.toLowerCase() === last);
}

// Programs that move into a folder: the folder is a target when the line goes on to write there.
const CHANGE_DIRECTORY = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl', 'push-location']);
// Options of cd and Set-Location that take no value, and those that name the folder.
const PATH_OPTIONS = new Set(['-path', '-literalpath', '-lp', '-pspath']);

/** The folder a cd-like command moves into, its options skipped: cd -P x, cd -- x, Set-Location -Path x. */
function changedDirectory(words: readonly string[]): string | undefined {
  for (let index = 1; index < words.length; index++) {
    const word = words[index] as string;
    if (PATH_OPTIONS.has(word.toLowerCase())) return words[index + 1];
    if (word === '--') return words[index + 1];
    if (!word.startsWith('-') || word === '-') return word;
  }
  return undefined;
}

/** The folders that env -C, env --chdir=, sudo -D and the like run their command in, read before the wrapper is taken off. */
function chdirTargets(words: readonly string[]): string[] {
  const options = value(shared.chdirOptions).options;
  const found: string[] = [];
  let runner: readonly string[] | undefined;
  for (let index = 0; index < words.length; index++) {
    const word = words[index] as string;
    const name = program(word);
    if (Object.hasOwn(options, name)) {
      runner = options[name];
      continue;
    }
    if (runner === undefined || !word.startsWith('-')) continue;
    const [option, inline] = word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined];
    if (runner.includes(option)) {
      const target = inline ?? words[index + 1];
      if (target !== undefined) found.push(target);
      if (inline === undefined) index++;
    }
  }
  return found;
}

/**
 * The words of a command line that may name a file it changes: every word of a command not known to only read, and the
 * targets of redirections, which always write.
 */
export function checkedWords(line: string, dialect: Dialect = 'sh'): string[] {
  const raw = commands(line, dialect);
  const all = raw.flatMap((command) => unwrapCommand(command));
  const targets = (words: readonly string[]): string[] =>
    words.flatMap((word, index) => {
      const redirect = REDIRECT.exec(word);
      if (redirect === null) return [];
      return [redirect[1] === '' ? (words[index + 1] ?? '') : (redirect[1] ?? '')];
    });
  // A file name that comes from another command (a redirect to $(echo X), xargs, parallel) is a word of a command that
  // only reads, so then every word of the line counts (review of 2026-11-09).
  // So does a command that writes with a variable or a substitution in its words (rm "$f" after a loop over .claude),
  // and in PowerShell a pipeline into a command that may write, which binds the file names it gets (gci .claude | Remove-Item).
  const expansion = dialect === 'sh' ? /[$`]/ : dialect === 'powershell' ? /\$/ : /%[^%\s]+%/;
  const dynamic =
    all.some((words) => DYNAMIC.has(program(words[0] ?? ''))) ||
    all.some((words) => targets(words).some((target) => target === '' || expansion.test(target))) ||
    all.some((words) => !readOnly(words) && words.slice(1).some((word) => expansion.test(word))) ||
    (dialect === 'powershell' && /\|/.test(line) && all.some((words) => !readOnly(words)));
  const checked = all.flatMap((words) => (dynamic || !readOnly(words) ? words : targets(words)));
  // A file name kept in a variable: F=CLAUDE.md; echo x > $F. Assignments count when the line uses a variable.
  if (/[$`]/.test(line)) for (const words of raw) checked.push(...words.filter((word) => ASSIGNMENT.test(word)));
  // cd into an agent folder, then a write by a relative name: cd .claude && echo x > settings.json (review of 2026-11-09),
  // also cd -P, pushd, Set-Location, env -C and sudo -D (review of 2026-11-10). The folder counts only when the line writes anything.
  const moves = (words: readonly string[]) => CHANGE_DIRECTORY.has(program(words[0] ?? ''));
  const writes = all.some((words) => !moves(words) && (!readOnly(words) || targets(words).length > 0));
  if (writes) {
    for (const words of all) {
      const folder = moves(words) ? changedDirectory(words) : undefined;
      if (folder !== undefined) checked.push(folder);
    }
    for (const words of raw) checked.push(...chdirTargets(words));
  }
  return checked;
}

// Folders of the project that hold only agent configuration, named alone: rm -rf .claude, cp -r x/. .claude/. Shared
// folders (.github, .vscode, .config) are left out: a command that writes there is no change of an agent by itself.
const SHARED_FOLDERS = new Set(['.github', '.vscode', '.config']);
let agentRoots: readonly string[] | undefined;
function agentRootFolders(): readonly string[] {
  agentRoots ??= [...new Set([...agentFolders(knowledgeBase), ...agentFileNames(knowledgeBase)].filter((path) => path.startsWith('.') && path.includes('/')).map((path) => path.slice(0, path.indexOf('/'))))]
    .filter((folder) => !SHARED_FOLDERS.has(folder))
    .sort();
  return agentRoots;
}

// Programs that take the names of the files they act on from another command.
const DYNAMIC = new Set(['xargs', 'parallel']);

const GLOB = /[*?[{]/;
const MAX_GLOB_WORDS = 64;
const MAX_GLOB_LENGTH = 512;
const MAX_BRACES = 32;

/** The words of {a,b} spelled out, at most MAX_BRACES of them; nested braces are left as they are. */
function expandBraces(word: string): string[] {
  const match = /\{([^{}]*,[^{}]*)\}/.exec(word);
  if (match === null) return [word];
  const before = word.slice(0, match.index);
  const after = word.slice(match.index + match[0].length);
  return match[1]!.split(',').slice(0, MAX_BRACES).flatMap((part) => expandBraces(`${before}${part}${after}`).slice(0, MAX_BRACES)).slice(0, MAX_BRACES);
}

/** A shell glob as a regular expression for one path, with * and ? not crossing a slash; runs of * are one. */
function globExpression(glob: string): RegExp | undefined {
  let source = '';
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index] as string;
    if (char === '*') {
      if (!source.endsWith('[^/]*')) source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '[') {
      const end = glob.indexOf(']', index + 2);
      if (end === -1) return undefined;
      const inner = glob.slice(index + 1, end).replace(/^!/, '^').replace(/[\\\]]/g, '\\$&');
      source += `[${inner}]`;
      index = end;
    } else {
      source += char.replace(/[.+^${}()|\\]/g, '\\$&');
    }
  }
  try {
    return new RegExp(`^${source}$`, 'i');
  } catch {
    return undefined;
  }
}

/** The agent file or folder a word with a glob or braces can name, matched against the end of the path it spells. */
function globbedAgentFile(word: string, fileNames: readonly string[]): string | undefined {
  if (word.length > MAX_GLOB_LENGTH) return undefined;
  for (const spelled of expandBraces(word)) {
    const parts = spelled.replace(/(?:\/+\.?)+$/, '').split('/');
    for (const name of fileNames) {
      const depth = name.split('/').length;
      const tail = parts.slice(-depth).join('/');
      if (!GLOB.test(tail)) {
        if (tail.toLowerCase() === name.toLowerCase()) return name;
        continue;
      }
      if (globExpression(tail)?.test(name) === true) return name;
    }
    const last = parts.at(-1) ?? '';
    for (const folder of agentRootFolders()) {
      if (GLOB.test(last) ? globExpression(last)?.test(folder) === true : last.toLowerCase() === folder.toLowerCase()) return folder;
    }
  }
  return undefined;
}
