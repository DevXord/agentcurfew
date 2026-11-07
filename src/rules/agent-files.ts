import type { AgentKnowledge, AgentPath, Fact } from '../knowledge/types.ts';

function values<T>(fact: Fact<T>): T[] {
  return fact.status === 'disputed' ? fact.variants.map((variant) => variant.value) : [fact.value];
}

function paths(agent: AgentKnowledge): AgentPath[] {
  const list: AgentPath[] = [];
  for (const files of values(agent.precedence)) list.push(...files);
  for (const mcp of values(agent.mcp)) if (mcp !== null) list.push(...mcp.files);
  for (const hooks of values(agent.hooks)) if (hooks !== null) list.push(...hooks.files);
  for (const files of values(agent.contextFiles)) list.push(...files);
  for (const permissions of values(agent.permissions)) if (permissions !== null) list.push(...permissions.files);
  for (const autoRun of values(agent.autoRun)) if (autoRun !== null) list.push(...autoRun.files);
  for (const skills of values(agent.skills)) if (skills !== null) list.push({ path: `x/${skills.entryFile}`, scope: 'project', format: 'markdown' });
  return list;
}

const GENERIC = new Set(['config.json', 'settings.json', 'config.toml', 'hooks.json', 'mcp.json', 'cli.json']);

/**
 * File names that steer an agent, taken from the knowledge base: a write to one is a write to the agent's own
 * configuration. Names too common to mean an agent on their own (settings.json) count only with their folder.
 */
export function agentFileNames(knowledge: readonly AgentKnowledge[]): string[] {
  const names = new Set<string>();
  for (const agent of knowledge) {
    for (const entry of paths(agent)) {
      const parts = entry.path.split('/');
      const last = parts.at(-1) ?? '';
      if (last === '' || last.includes('*')) continue;
      const folder = parts.at(-2);
      if (GENERIC.has(last)) {
        if (folder !== undefined && !folder.includes('*') && folder.startsWith('.')) names.add(`${folder}/${last}`);
      } else {
        names.add(last);
      }
    }
  }
  return [...names].sort();
}

/**
 * Folders whose files steer an agent, where the knowledge base names them with a wildcard: .cursor/rules/,
 * .claude/skills/, .devin/workflows/. Each starts at its first dot folder, so ~/ and **\/ prefixes fall away; system
 * folders without one (/etc/devin) are left out, since their names are too plain to mean an agent.
 */
export function agentFolders(knowledge: readonly AgentKnowledge[]): string[] {
  const folders = new Set<string>();
  const add = (path: string): void => {
    const parts = path.split('/');
    const wild = parts.findIndex((part) => part.includes('*'));
    const kept = wild === -1 ? parts : parts.slice(0, wild);
    const dot = kept.findIndex((part) => part.startsWith('.') && part.length > 1);
    if (dot !== -1) folders.add(`${kept.slice(dot).join('/')}/`);
  };
  for (const agent of knowledge) {
    for (const entry of paths(agent)) if (entry.path.includes('*')) add(entry.path);
    for (const skills of values(agent.skills)) if (skills !== null) for (const directory of skills.directories) add(`${directory.path}/*`);
    if (agent.extensions !== undefined) {
      for (const extensions of values(agent.extensions)) if (extensions !== null) for (const entry of [...extensions.subagents, ...extensions.commands]) add(entry.path.includes('*') ? entry.path : `${entry.path}/*`);
    }
  }
  return [...folders].sort();
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A pattern that matches any of the names as a path or a path's end. */
export function agentFilePattern(knowledge: readonly AgentKnowledge[]): string {
  return `(?:${agentFileNames(knowledge).map(escapeRegExp).join('|')})`;
}
