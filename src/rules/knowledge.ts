import type { Component } from '../inventory/types.ts';
import type { AgentKnowledge, Fact, PermissionsKnowledge, SkillsKnowledge } from '../knowledge/types.ts';

function values<T>(fact: Fact<T>): T[] {
  return fact.status === 'disputed' ? fact.variants.map((variant) => variant.value) : [fact.value];
}

/** The agents of the knowledge base that read a component. */
export function agentsOf(component: Component, knowledge: readonly AgentKnowledge[]): AgentKnowledge[] {
  return knowledge.filter((agent) => component.agents.includes(agent.id));
}

export function permissionFacts(agent: AgentKnowledge): PermissionsKnowledge[] {
  return values(agent.permissions).filter((value): value is PermissionsKnowledge => value !== null);
}

export function skillFacts(agent: AgentKnowledge): SkillsKnowledge[] {
  return values(agent.skills).filter((value): value is SkillsKnowledge => value !== null);
}

/** Whether a found dotted path, such as mcpServers.db.trust, is the knowledge key mcpServers.*.trust. */
export function keyMatches(found: string, key: string): boolean {
  const pattern = key
    .split('.')
    .map((segment) => (segment === '*' || segment.startsWith('<') ? '[^.]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('\\.');
  return new RegExp(`^${pattern}$`).test(found);
}
