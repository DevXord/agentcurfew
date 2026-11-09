import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Component, Inventory } from '../inventory/types.ts';
import { knowledgeBase } from '../knowledge/index.ts';
import { commands } from '../rules/command-words.ts';
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

// The shortest timeout, in seconds, with which a guard can still finish a check of a large project: a smaller one makes
// Claude Code stop the hook before it answers, and the call goes through (review of 2026-11-09).
const MIN_GUARD_TIMEOUT = 10;

function program(word: string): string {
  return (word.split(/[\\/]/).at(-1) ?? '').toLowerCase().replace(/\.(?:cmd|exe)$/, '');
}

/** Whether a matcher of a hook group covers every one of the tools: a list of exact names, or a regular expression. */
function covers(matcher: unknown, tools: readonly string[]): boolean {
  if (matcher === undefined || matcher === '' || matcher === '*') return true;
  if (typeof matcher !== 'string' || matcher.length > 256) return false;
  if (/^[\w\s,|-]+$/.test(matcher)) {
    const names = new Set(matcher.split(/[|,]/).map((name) => name.trim()));
    return tools.every((tool) => names.has(tool));
  }
  try {
    const pattern = new RegExp(matcher);
    return tools.every((tool) => pattern.test(tool));
  } catch {
    return false;
  }
}

/**
 * The words a guard's handler runs, when it is nothing but node running the guard's file, or the guard's own binary:
 * with args the program and its arguments, otherwise the command split as a shell would, which must be one command.
 */
function handlerWords(handler: Record<string, unknown>): string[] | undefined {
  if (typeof handler.command !== 'string') return undefined;
  if (Array.isArray(handler.args)) return handler.args.every((arg) => typeof arg === 'string') ? [handler.command, ...(handler.args as string[])] : undefined;
  const split = commands(handler.command);
  return split.length === 1 ? split[0] : undefined;
}

/** Whether words start agentcurfew's hook or depcurfew's check: node <path to cli.js> or the binary, then the subcommand. */
function startsGuard(words: readonly string[], name: 'agentcurfew' | 'depcurfew'): boolean {
  let rest = words;
  if (program(rest[0] ?? '') === 'node') {
    const file = (rest[1] ?? '').replaceAll('\\', '/');
    if (!file.endsWith(`/node_modules/${name}/dist/cli.js`) && file !== `node_modules/${name}/dist/cli.js`) return false;
    rest = rest.slice(2);
  } else if (program(rest[0] ?? '') === 'npx' && program(rest[1] ?? '') === name) {
    rest = rest.slice(2);
  } else if (program(rest[0] ?? '') === name || (name === 'depcurfew' && program(rest[0] ?? '') === 'dcf')) {
    rest = rest.slice(1);
  } else {
    return false;
  }
  if (name === 'agentcurfew') return rest.length === 1 && rest[0] === 'hook';
  return rest[0] === 'check' && rest.includes('--hook');
}

/**
 * The guards of the project that can act: a PreToolUse hook whose matcher covers the tools the guard checks, whose
 * handler runs the guard and nothing else, and whose timeout leaves it time to answer. A hook moved to another event,
 * given a matcher that never fires, a decoy handler that only names the guard, or a tiny timeout guards nothing.
 */
export function workingGuards(inventory: Inventory): { depcurfew: Component[]; agentcurfew: Component[] } {
  const working = (component: Component, name: 'agentcurfew' | 'depcurfew', tools: readonly string[]): boolean => {
    if (!component.name.startsWith('PreToolUse#')) return false;
    const value = entryValue(component);
    if (!isRecord(value) || !isRecord(value.handler)) return false;
    const handler = value.handler;
    if (handler.type !== undefined && handler.type !== 'command') return false;
    // if limits the handler to the calls that match a permission rule, so the guard may never run.
    if (handler.if !== undefined) return false;
    if (handler.timeout !== undefined && (typeof handler.timeout !== 'number' || handler.timeout < MIN_GUARD_TIMEOUT)) return false;
    const words = handlerWords(handler);
    return words !== undefined && startsGuard(words, name) && covers(value.matcher, tools);
  };
  const hooks = guardHooks(inventory);
  return {
    depcurfew: hooks.depcurfew.filter((component) => working(component, 'depcurfew', ['Bash'])),
    agentcurfew: hooks.agentcurfew.filter((component) => working(component, 'agentcurfew', ['Bash', 'Write', 'Edit'])),
  };
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
  // Guards that can act, before and after: a change that keeps the command string but stops the hook from running
  // counts as removing it (review of 2026-11-09).
  const was = workingGuards(before);
  const is = workingGuards(after);
  if (was.depcurfew.length > 0 && is.depcurfew.length === 0 && existsSync(join(root, 'depcurfew.json'))) reasons.push('remove the depcurfew hook, which checks the packages the agent installs');
  if (was.agentcurfew.length > 0 && is.agentcurfew.length === 0) reasons.push('remove the agentcurfew hook, which checks the agent\'s writes to these files');
  return reasons;
}
