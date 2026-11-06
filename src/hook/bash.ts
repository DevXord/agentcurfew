import type { Component } from '../inventory/types.ts';
import { knowledgeBase } from '../knowledge/index.ts';
import { shared } from '../knowledge/shared.ts';
import type { AgentKnowledge, McpAddKnowledge, SkillsInstallerKnowledge } from '../knowledge/types.ts';
import { serverIdentity } from '../lock/build.ts';
import type { Policy } from '../policy/types.ts';
import { agentFilePattern } from '../rules/agent-files.ts';
import { atLeast, runRules } from '../rules/index.ts';
import { quote } from '../rules/mask.ts';
import { allowedBy } from '../rules/rules/out-of-policy.ts';
import { writesTo } from '../rules/shell.ts';
import type { Verdict } from './types.ts';

/** Words of one simple command, with quotes removed; commands are split on ;, &&, ||, | and newlines outside quotes. */
export function commands(line: string): string[][] {
  const result: string[][] = [];
  let words: string[] = [];
  let word = '';
  let quoted: '"' | "'" | undefined;
  let started = false;
  const endWord = () => {
    if (started) words.push(word);
    word = '';
    started = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) result.push(words);
    words = [];
  };
  for (let index = 0; index < line.length; index++) {
    const char = line[index] as string;
    if (quoted !== undefined) {
      if (char === quoted) quoted = undefined;
      else if (char === '\\' && quoted === '"' && index + 1 < line.length) word += line[++index];
      else word += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quoted = char;
      started = true;
    } else if (char === '\\' && index + 1 < line.length) {
      word += line[++index];
      started = true;
    } else if (char === ';' || char === '\n' || char === '|' || char === '&') {
      endCommand();
      if ((char === '|' || char === '&') && line[index + 1] === char) index++;
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      word += char;
      started = true;
    }
  }
  endCommand();
  return result;
}

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
  while (words[index]?.startsWith('-')) index++;
  const name = words[index] ?? '';
  if (name !== installer.packageName && !name.startsWith(`${installer.packageName}@`)) return undefined;
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

let writePattern: RegExp | undefined;

/** A Bash command line: skills and MCP servers being added, and shell writes to the files that steer agents. */
export function checkCommand(line: string, policy: Policy | undefined): Verdict[] {
  const verdicts: Verdict[] = [];
  for (const words of commands(line)) {
    const source = skillsSource(words);
    if (source !== undefined) verdicts.push(checkSkillsAdd(source, policy));
    const added = addedServer(words);
    if (added !== undefined) verdicts.push(checkMcpAdd(added, policy));
  }
  writePattern ??= writesTo(`(?:${agentFilePattern(knowledgeBase)}|agentcurfew\\.policy\\.json|agentcurfew\\.lock|skills-lock\\.json)`);
  if (writePattern.test(line)) verdicts.push({ decision: 'ask', reasons: ['agentcurfew: this command writes to a file that steers an agent, and its new content cannot be checked before it runs.'] });
  return verdicts;
}
