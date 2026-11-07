import type { Component } from '../inventory/types.ts';
import type { AgentKnowledge, McpKnowledge } from '../knowledge/types.ts';
import { entryValue, isRecord } from './text.ts';

function mcpFacts(component: Component, knowledge: readonly AgentKnowledge[]): McpKnowledge[] {
  const list: McpKnowledge[] = [];
  for (const agent of knowledge) {
    if (!component.agents.includes(agent.id)) continue;
    const values = agent.mcp.status === 'disputed' ? agent.mcp.variants.map((variant) => variant.value) : [agent.mcp.value];
    for (const value of values) if (value !== null) list.push(value);
  }
  return list;
}

export interface McpEntry {
  command?: string;
  args: string[];
  env: Record<string, unknown>;
  urls: string[];
  headers: Record<string, unknown>;
}

function firstString(record: Record<string, unknown>, names: Iterable<string>): string | undefined {
  for (const name of names) if (typeof record[name] === 'string') return record[name];
  return undefined;
}

/** The fields of a server entry under the names its agents use (knowledge base), merged across agents. */
export function mcpEntry(component: Component, knowledge: readonly AgentKnowledge[]): McpEntry | undefined {
  const value = entryValue(component);
  if (!isRecord(value)) return undefined;
  const facts = mcpFacts(component, knowledge);
  const local = facts.flatMap((fact) => (fact.local === null ? [] : [fact.local]));
  const remote = facts.flatMap((fact) => (fact.remote === null ? [] : [fact.remote]));
  const command = firstString(value, new Set(local.map((fields) => fields.command)));
  const args: string[] = [];
  for (const name of new Set(local.map((fields) => fields.args))) {
    const list = value[name];
    if (Array.isArray(list)) for (const item of list) if (typeof item === 'string' || typeof item === 'number') args.push(String(item));
  }
  const env: Record<string, unknown> = {};
  for (const name of new Set(local.map((fields) => fields.env))) if (isRecord(value[name])) Object.assign(env, value[name]);
  const urls: string[] = [];
  for (const name of new Set(remote.flatMap((fields) => [fields.url, ...(fields.otherUrls ?? [])]))) if (typeof value[name] === 'string') urls.push(value[name]);
  const headers: Record<string, unknown> = {};
  for (const name of new Set(remote.flatMap((fields) => (fields.headers === null ? [] : [fields.headers])))) if (isRecord(value[name])) Object.assign(headers, value[name]);
  return { ...(command === undefined ? {} : { command }), args, env, urls, headers };
}

/** The command split into words when it was written as one string, followed by the arguments. */
export function commandLine(entry: McpEntry): string[] {
  if (entry.command === undefined) return [];
  const words = entry.args.length === 0 ? (entry.command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((word) => word.replace(/^["']|["']$/g, '')) : [entry.command];
  return [...words, ...entry.args];
}
