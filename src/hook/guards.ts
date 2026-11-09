import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Component, Inventory } from '../inventory/types.ts';
import { knowledgeBase } from '../knowledge/index.ts';
import { entryValue, isRecord } from '../rules/text.ts';
import { isOwnHook } from './install.ts';

/** The command line of a hook handler as one string: command, then args. */
export function handlerLine(component: Component): string | undefined {
  const value = entryValue(component);
  const handler = isRecord(value) && isRecord(value.handler) ? value.handler : value;
  if (!isRecord(handler) || typeof handler.command !== 'string') return undefined;
  const args = Array.isArray(handler.args) ? handler.args.filter((arg): arg is string => typeof arg === 'string') : [];
  return [handler.command, ...args].join(' ');
}

/** Whether a hook command line is depcurfew's guard of installs for Claude Code. */
export function isDepcurfewHook(line: string): boolean {
  return /\bdepcurfew\b(?:\/dist\/cli\.js["']?)?\s+check\b.*--hook\b/.test(line) || /\bdcf\s+check\b.*--hook\b/.test(line);
}

/** The Claude Code hooks of the project that guard the agent: depcurfew's and agentcurfew's own. */
export function guardHooks(inventory: Inventory): { depcurfew: Component[]; agentcurfew: Component[] } {
  const hooks = inventory.components.filter((component) => component.kind === 'hook' && component.scope === 'project' && component.agents.includes('claude-code'));
  return {
    depcurfew: hooks.filter((component) => isDepcurfewHook(handlerLine(component) ?? '')),
    agentcurfew: hooks.filter((component) => isOwnHook(handlerLine(component) ?? '')),
  };
}

/** The project settings that turn every hook off (Claude Code disableAllHooks set to true). */
export function hooksOff(inventory: Inventory): Component[] {
  const keys = new Set(knowledgeBase.flatMap((agent) => (agent.hooksOff === undefined ? [] : (agent.hooksOff.status === 'disputed' ? agent.hooksOff.variants.map((variant) => variant.value) : [agent.hooksOff.value]).map((value) => `${agent.id}\0${value.key}`))));
  return inventory.components.filter((component) => component.kind === 'setting' && component.scope === 'project' && component.agents.some((agent) => keys.has(`${agent}\0${component.name}`)) && entryValue(component) === true);
}

/**
 * What a change does to the hooks that guard the agent (D-051): turns every hook off, or removes depcurfew's hook from
 * a project with depcurfew.json, or agentcurfew's own. A write that does any of it is denied, since the agent would
 * switch off the checks of its own writes and installs.
 */
export function weakenedGuards(before: Inventory, after: Inventory, root: string): string[] {
  const reasons: string[] = [];
  const offBefore = new Set(hooksOff(before).map((component) => `${component.file}\0${component.name}`));
  for (const component of hooksOff(after)) {
    if (!offBefore.has(`${component.file}\0${component.name}`)) reasons.push(`set ${component.name} in ${component.file}, which turns off every hook of the project and the user, depcurfew's and agentcurfew's included`);
  }
  const was = guardHooks(before);
  const is = guardHooks(after);
  if (was.depcurfew.length > 0 && is.depcurfew.length === 0 && existsSync(join(root, 'depcurfew.json'))) reasons.push('remove the depcurfew hook, which checks the packages the agent installs');
  if (was.agentcurfew.length > 0 && is.agentcurfew.length === 0) reasons.push('remove the agentcurfew hook, which checks the agent\'s writes to these files');
  return reasons;
}
