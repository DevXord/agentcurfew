import type { AgentKnowledge, AgentPath, Evidence, Fact, McpKnowledge } from '../knowledge/types.ts';

export interface KnownPath {
  agent: AgentKnowledge;
  entry: AgentPath;
  source: string;
}

function evidence<T>(fact: Fact<T>): readonly Evidence<T>[] {
  return fact.status === 'disputed' ? fact.variants : [fact];
}

function paths(value: unknown): AgentPath[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(paths);
  const record = value as Record<string, unknown>;
  if (typeof record.path === 'string' && typeof record.scope === 'string' && typeof record.format === 'string') return [record as unknown as AgentPath];
  return Object.values(record).flatMap(paths);
}

/** Every path of the knowledge base, with its agent and the source of the fact that names it. */
export function knownPaths(knowledge: readonly AgentKnowledge[]): KnownPath[] {
  const list: KnownPath[] = [];
  for (const agent of knowledge) {
    for (const field of ['precedence', 'mcp', 'hooks', 'skills', 'contextFiles', 'permissions', 'autoRun', 'extensions'] as const) {
      for (const item of evidence(agent[field] as Fact<unknown>)) for (const entry of paths(item.value)) list.push({ agent, entry, source: item.source });
    }
  }
  return list;
}

/** The MCP facts of an agent, every variant, with their sources. */
export function mcpFacts(agent: AgentKnowledge): { mcp: McpKnowledge; source: string }[] {
  return evidence(agent.mcp).flatMap((item) => (item.value === null ? [] : [{ mcp: item.value, source: item.source }]));
}

export function evidenceOf<T>(fact: Fact<T>): readonly Evidence<T>[] {
  return evidence(fact);
}
