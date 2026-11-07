import type { Component } from '../inventory/types.ts';
import { knowledgeBase } from '../knowledge/index.ts';
import { shared } from '../knowledge/shared.ts';
import type { AgentKnowledge, McpAddKnowledge, SkillsInstallerKnowledge } from '../knowledge/types.ts';
import { serverIdentity } from '../lock/build.ts';
import type { Policy } from '../policy/types.ts';
import { agentFilePattern, agentFolders, escapeRegExp } from '../rules/agent-files.ts';
import { atLeast, runRules } from '../rules/index.ts';
import { quote } from '../rules/mask.ts';
import { allowedBy } from '../rules/rules/out-of-policy.ts';
import { writesTo } from '../rules/shell.ts';
import type { Matcher } from '../rules/shell.ts';
import type { Verdict } from './types.ts';

import { commands, unwrapCommand } from '../rules/command-words.ts';

export { commands };

const LAUNCHERS: readonly (readonly string[])[] = [['npx'], ['pnpx'], ['bunx'], ['pnpm', 'dlx'], ['yarn', 'dlx'], ['npm', 'exec'], ['bun', 'x']];

function skillsFact(): SkillsInstallerKnowledge {
  return shared.skillsInstaller.status === 'disputed' ? shared.skillsInstaller.variants[0].value : shared.skillsInstaller.value;
}

/** The source of `npx skills add <source>` and its launcher variants, or undefined. */
export function skillsSource(words: readonly string[]): string | undefined {
  const installer = skillsFact();
  const launcher = LAUNCHERS.find((prefix) => prefix.every((part, index) => words[index] === part));
  if (launcher === undefined) return undefined;
  let index = launcher.length;
  // npx -p skills skills add: the package comes with -p, and the word after the options is its command.
  let fromOption: string | undefined;
  while (words[index]?.startsWith('-')) {
    const [option, inline] = (words[index] as string).split('=', 2) as [string, string | undefined];
    const takesValue = (option === '-p' || option === '--package') && inline === undefined;
    if (option === '-p' || option === '--package') fromOption = inline ?? words[index + 1];
    index += takesValue ? 2 : 1;
  }
  const name = words[index] ?? '';
  const isInstaller = (word: string | undefined) => word !== undefined && (word === installer.packageName || word.startsWith(`${installer.packageName}@`));
  if (!isInstaller(name) && !(isInstaller(fromOption) && name === installer.packageName)) return undefined;
  if (words[index + 1] === '--') index++;
  if (words[index + 1] !== installer.addCommand) return undefined;
  const rest = words.slice(index + 2);
  // The source is the word after add; options such as -a take several values, so when they come first the source is the
  // last word that is not an option.
  if (rest[0] !== undefined && !rest[0].startsWith('-')) return rest[0];
  const plain = rest.filter((word) => !word.startsWith('-'));
  return plain.at(-1);
}

function mcpAddFacts(): { agent: AgentKnowledge; mcpAdd: McpAddKnowledge }[] {
  return knowledgeBase.flatMap((agent) => (agent.mcpAdd === undefined ? [] : (agent.mcpAdd.status === 'disputed' ? agent.mcpAdd.variants.map((variant) => variant.value) : [agent.mcpAdd.value]).map((mcpAdd) => ({ agent, mcpAdd }))));
}

/** The server an `<agent> mcp add` or `add-json` command would add, as an entry of .mcp.json, or undefined. */
export function addedServer(words: readonly string[]): { agent: AgentKnowledge; name: string; entry: Record<string, unknown> } | undefined {
  for (const { agent, mcpAdd } of mcpAddFacts()) {
    const json = mcpAdd.jsonCommand.every((part, index) => words[index] === part);
    const plain = !json && mcpAdd.command.every((part, index) => words[index] === part);
    if (!json && !plain) continue;
    const rest = words.slice((json ? mcpAdd.jsonCommand : mcpAdd.command).length);
    const separator = rest.indexOf(mcpAdd.separator);
    const head = separator === -1 ? rest : rest.slice(0, separator);
    const positional: string[] = [];
    let transport = 'stdio';
    for (let index = 0; index < head.length; index++) {
      const word = head[index] as string;
      if (mcpAdd.valueOptions.includes(word)) {
        if (word === '--transport' || word === '-t') transport = head[index + 1] ?? transport;
        index++;
      } else if (!word.startsWith('-')) {
        positional.push(word);
      }
    }
    const name = positional[0] ?? '';
    if (json) {
      try {
        const value = JSON.parse(positional[1] ?? '') as unknown;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) return { agent, name, entry: value as Record<string, unknown> };
      } catch {
        return { agent, name, entry: {} };
      }
      return { agent, name, entry: {} };
    }
    if (transport === 'http' || transport === 'sse') return { agent, name, entry: { type: transport, url: positional[1] ?? '' } };
    const command = separator === -1 ? positional.slice(1) : rest.slice(separator + 1);
    return { agent, name, entry: { command: command[0] ?? '', args: command.slice(1) } };
  }
  return undefined;
}

function checkSkillsAdd(source: string, policy: Policy | undefined): Verdict {
  const sources = policy?.skills?.allowSources;
  const local = /^(?:\.{0,2}\/|[A-Za-z]:[\\/]|~\/)/.test(source);
  const shown = quote(source, 100);
  if (sources !== undefined) {
    const allowed = local ? sources.includes('local') : allowedBy(sources, source);
    if (!allowed) return { decision: 'deny', reasons: [`agentcurfew: the skill source ${shown} is not in skills.allowSources of agentcurfew.policy.json.`] };
  }
  return { decision: 'ask', reasons: [`agentcurfew: this installs the skill ${shown}, which can bring instructions and scripts the agent will follow; check it first with the MCP tool check_skill or agentcurfew scan.`] };
}

function checkMcpAdd(added: NonNullable<ReturnType<typeof addedServer>>, policy: Policy | undefined): Verdict {
  const component: Component = { kind: 'mcp-server', agents: [added.agent.id], scope: 'project', file: '.mcp.json', name: added.name, raw: JSON.stringify(added.entry) };
  const shown = quote(added.name, 60);
  const reasons: string[] = [];
  const servers = policy?.mcp?.allowServers;
  if (servers !== undefined) {
    const { names, local } = serverIdentity(component);
    const allowed = local ? servers.includes('local') : names.length > 0 && names.some((name) => allowedBy(servers, name));
    if (!allowed) reasons.push(`the MCP server ${shown} (${names.map((name) => quote(name, 80)).join(', ') || 'a local command'}) is not in mcp.allowServers of agentcurfew.policy.json`);
  }
  const findings = runRules({ components: [component], problems: [] }).filter((finding) => finding.rule !== 'out-of-policy');
  const serious = findings.filter((finding) => atLeast(finding.level, 'high'));
  reasons.push(...serious.map((finding) => `${finding.rule}: ${finding.message}`));
  if (reasons.length > 0) return { decision: 'deny', reasons: [`agentcurfew: ${reasons.join('; ')}.`] };
  const notes = findings.map((finding) => ` ${finding.rule}: ${finding.message}.`).join('');
  return { decision: 'ask', reasons: [`agentcurfew: this adds the MCP server ${shown} to ${added.agent.name}.${notes}`] };
}

let writePattern: Matcher | undefined;
const MAX_STARTS = 32;
let starters: ReadonlySet<string> | undefined;

/** The words an install command can begin with: the launchers of skills add and the agents' mcp add commands. */
function firstWords(): ReadonlySet<string> {
  starters ??= new Set([...LAUNCHERS.map((launcher) => launcher[0] as string), ...mcpAddFacts().flatMap(({ mcpAdd }) => [mcpAdd.command[0], mcpAdd.jsonCommand[0]]).filter((word): word is string => word !== undefined)]);
  return starters;
}

/** A Bash command line: skills and MCP servers being added, and shell writes to the files that steer agents. */
export function checkCommand(line: string, policy: Policy | undefined): Verdict[] {
  const verdicts: Verdict[] = [];
  // Each command with its wrappers taken off: CI=1 npx skills add, (npx skills add) and bash -c "npx skills add" are checked alike.
  // A wrapper agentcurfew does not know may still run the install with the words after it, so every word that can begin
  // one is tried; at most MAX_STARTS of them, since each try reads the rest of the command.
  const first = firstWords();
  let tries = 0;
  for (const words of commands(line).flatMap((command) => unwrapCommand(command))) {
    for (let start = 0; start < words.length; start++) {
      // The first word of each command is always tried, which reads each word once; only later starts count.
      if (start > 0 && !first.has(words[start] ?? '')) continue;
      if (start > 0 && ++tries > MAX_STARTS) {
        verdicts.push({ decision: 'ask', reasons: ['agentcurfew: this command line is too long and repetitive to check for installs of skills and MCP servers.'] });
        return verdicts;
      }
      const rest = words.slice(start);
      const source = skillsSource(rest);
      const added = source === undefined ? addedServer(rest) : undefined;
      if (source !== undefined) verdicts.push(checkSkillsAdd(source, policy));
      if (added !== undefined) verdicts.push(checkMcpAdd(added, policy));
      if (source !== undefined || added !== undefined) break;
    }
  }
  writePattern ??= writesTo(`(?:${agentFilePattern(knowledgeBase)}|agentcurfew\\.policy\\.json|agentcurfew\\.lock|skills-lock\\.json)`);
  if (writePattern.test(line)) {
    verdicts.push({ decision: 'ask', reasons: ['agentcurfew: this command writes to a file that steers an agent, and its new content cannot be checked before it runs.'] });
    return verdicts;
  }
  const named = namedAgentFile(line);
  if (named !== undefined) verdicts.push({ decision: 'ask', reasons: [`agentcurfew: this command names ${quote(named, 80)}, which steers an agent, and agentcurfew cannot tell from the command whether it changes it.`] });
  return verdicts;
}

// Commands that only read the files they name. Anything else that names an agent file may write it: curl -o, dd of=,
// python -c, perl -pi, git checkout --, unzip, install and many more, so asking is the safe answer.
const READ_ONLY = new Set(['cat', 'less', 'more', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'wc', 'diff', 'cmp', 'ls', 'stat', 'file', 'md5sum', 'sha1sum', 'sha256sum', 'bat', 'jq', 'echo', 'printf', 'test', '[', 'realpath', 'readlink', 'dirname', 'basename', 'agentcurfew', 'depcurfew', 'code', 'open']);
const GIT_READ_ONLY = new Set(['diff', 'log', 'show', 'status', 'blame', 'ls-files', 'grep', 'add', 'commit', 'reset']);
const FIND_WRITES = /^-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/;
// A redirection word: >, >>, >|, 1>, 2>>, &> and the like, alone or with its target joined to it.
const REDIRECT = /^[0-9&]*>{1,2}[|&]?(.*)$/;
let mentionPattern: RegExp | undefined;

function readOnly(words: readonly string[]): boolean {
  const program = (words[0]?.split(/[\\/]/).at(-1) ?? '').toLowerCase();
  if (program === 'git') return GIT_READ_ONLY.has(words.find((word, index) => index > 0 && !word.startsWith('-')) ?? '');
  if (program === 'find') return !words.some((word) => FIND_WRITES.test(word));
  if (program === 'sed') return !words.some((word) => /^(?:-i|--in-place)/.test(word));
  return READ_ONLY.has(program);
}

/** The first agent file a command names, when the command is not known to only read it; redirections always count. */
function namedAgentFile(line: string): string | undefined {
  mentionPattern ??= new RegExp(`(?:^|[^\\w.-])(${agentFilePattern(knowledgeBase)}|${agentFolders(knowledgeBase).map(escapeRegExp).join('|')}|agentcurfew\\.policy\\.json|agentcurfew\\.lock|skills-lock\\.json)(?![\\w-]|\\.\\w)`, 'i');
  for (const words of commands(line).flatMap((command) => unwrapCommand(command))) {
    const checked = readOnly(words)
      ? words.flatMap((word, index) => {
          const redirect = REDIRECT.exec(word);
          if (redirect === null) return [];
          return [redirect[1] === '' ? (words[index + 1] ?? '') : (redirect[1] ?? '')];
        })
      : words;
    for (const word of checked) {
      const match = mentionPattern.exec(word);
      if (match !== null) return match[1];
    }
  }
  return undefined;
}
