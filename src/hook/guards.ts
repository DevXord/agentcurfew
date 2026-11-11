import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Component, Inventory } from '../inventory/types.ts';
import { claudeCode } from '../knowledge/claude-code.ts';
import { knowledgeBase } from '../knowledge/index.ts';
import { shared } from '../knowledge/shared.ts';
import type { Fact, ToolHookKnowledge } from '../knowledge/types.ts';
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

function value<T>(fact: Fact<T>): T {
  return fact.status === 'disputed' ? fact.variants[0].value : fact.value;
}

function toolHook(): ToolHookKnowledge | undefined {
  return claudeCode.toolHook === undefined ? undefined : value(claudeCode.toolHook);
}

/** The project settings files of Claude Code: only hooks there guard every call (a skill's hooks run only while it is active). */
function settingsFiles(): ReadonlySet<string> {
  const files = claudeCode.hooksOff === undefined ? [] : value(claudeCode.hooksOff).files;
  return new Set(files.filter((file) => file.scope === 'project').map((file) => file.path));
}

/** The Claude Code hooks of the project's settings that guard the agent: depcurfew's and agentcurfew's own. */
export function guardHooks(inventory: Inventory): { depcurfew: Component[]; agentcurfew: Component[] } {
  const files = settingsFiles();
  const hooks = inventory.components.filter((component) => component.kind === 'hook' && component.scope === 'project' && component.agents.includes('claude-code') && files.has(component.file));
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
// Claude Code stop the hook before it answers, and the call goes through (review of 2026-11-09). agentcurfew's hook
// scans for up to 15 s (HOOK_BUDGET_MS in files.ts), so its guard needs more than that (review of 2026-11-10).
const MIN_GUARD_TIMEOUT: Readonly<Record<GuardName, number>> = { agentcurfew: 20, depcurfew: 10 };
// Tools a guard may cover beyond the ones it needs; a change that stops covering one weakens it (review of 2026-11-10).
const OPTIONAL_TOOLS: Readonly<Record<GuardName, readonly string[]>> = { agentcurfew: ['PowerShell', 'Monitor', 'NotebookEdit'], depcurfew: ['PowerShell', 'Monitor'] };
const REQUIRED_TOOLS: Readonly<Record<GuardName, readonly string[]>> = { agentcurfew: ['Bash', 'Write', 'Edit'], depcurfew: ['Bash'] };
type GuardName = 'agentcurfew' | 'depcurfew';

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
  const split = commands(handler.command, handler.shell === 'powershell' ? 'powershell' : 'sh');
  return split.length === 1 ? split[0] : undefined;
}

/** The files a guard's hook runs, relative to the project: its install in node_modules, and depcurfew's tools folder. */
function entryFiles(name: GuardName): readonly string[] {
  return name === 'agentcurfew' ? ['node_modules/agentcurfew/dist/cli.js'] : value(shared.depcurfew).entryFiles;
}

/**
 * Whether a file a guard's node runs is the project's own install: written from the project root (${CLAUDE_PROJECT_DIR}/,
 * $CLAUDE_PROJECT_DIR/, ./, the root itself, or nothing). A copy elsewhere, /tmp/x/node_modules/agentcurfew/dist/cli.js
 * or sub/node_modules/…, is code the project does not guard (review of 2026-11-10).
 */
function ownInstall(file: string, name: GuardName, root: string | undefined): boolean {
  const variable = toolHook()?.projectDirVariable ?? 'CLAUDE_PROJECT_DIR';
  const prefixes = ['', './', `\${${variable}}/`, `$${variable}/`, ...(root === undefined ? [] : [`${root.replaceAll('\\', '/')}/`])];
  return entryFiles(name).some((entry) => prefixes.some((prefix) => file === `${prefix}${entry}`));
}

/** Whether words start agentcurfew's hook or depcurfew's check: node <path to cli.js> or the binary, then the subcommand. */
function startsGuard(words: readonly string[], name: GuardName, root?: string): boolean {
  let rest = words;
  if (program(rest[0] ?? '') === 'node') {
    const file = (rest[1] ?? '').replaceAll('\\', '/');
    if (!ownInstall(file, name, root)) return false;
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
export function workingGuards(inventory: Inventory, root?: string): { depcurfew: Component[]; agentcurfew: Component[] } {
  const background = toolHook()?.backgroundFields ?? [];
  const working = (component: Component, name: GuardName): boolean => {
    if (!component.name.startsWith('PreToolUse#')) return false;
    const entry = entryValue(component);
    if (!isRecord(entry) || !isRecord(entry.handler)) return false;
    const handler = entry.handler;
    if (handler.type !== undefined && handler.type !== 'command') return false;
    // if limits the handler to the calls that match a permission rule, so the guard may never run.
    if (handler.if !== undefined) return false;
    // A hook run in the background cannot block the call it checks (review of 2026-11-10).
    if (background.some((field) => handler[field] === true)) return false;
    if (handler.timeout !== undefined && (typeof handler.timeout !== 'number' || handler.timeout < MIN_GUARD_TIMEOUT[name])) return false;
    const words = handlerWords(handler);
    return words !== undefined && startsGuard(words, name, root) && covers(entry.matcher, REQUIRED_TOOLS[name]);
  };
  const hooks = guardHooks(inventory);
  return {
    depcurfew: hooks.depcurfew.filter((component) => working(component, 'depcurfew')),
    agentcurfew: hooks.agentcurfew.filter((component) => working(component, 'agentcurfew')),
  };
}

/** The optional tools the working guards cover, and whether one of them makes a failure block the call. */
function strength(guards: readonly Component[], name: GuardName): { tools: Set<string>; blocks: boolean } {
  const failure = toolHook()?.failure;
  const tools = new Set<string>();
  let blocks = false;
  for (const component of guards) {
    const entry = entryValue(component);
    if (!isRecord(entry)) continue;
    for (const tool of OPTIONAL_TOOLS[name]) if (covers(entry.matcher, [tool])) tools.add(tool);
    if (failure !== undefined && isRecord(entry.handler) && entry.handler[failure.field] === failure.blocks) blocks = true;
  }
  return { tools, blocks };
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
  const was = workingGuards(before, root);
  const is = workingGuards(after, root);
  const counts = { depcurfew: existsSync(join(root, 'depcurfew.json')), agentcurfew: true };
  const what = { depcurfew: 'the depcurfew hook, which checks the packages the agent installs', agentcurfew: 'the agentcurfew hook, which checks the agent\'s writes to these files' };
  for (const name of ['depcurfew', 'agentcurfew'] as const) {
    if (!counts[name] || was[name].length === 0) continue;
    if (is[name].length === 0) {
      reasons.push(`remove ${what[name]}`);
      continue;
    }
    // Still there, but covering less, or no longer blocking the call when it fails (review of 2026-11-10).
    const old = strength(was[name], name);
    const now = strength(is[name], name);
    const lost = [...old.tools].filter((tool) => !now.tools.has(tool));
    if (lost.length > 0) reasons.push(`stop ${what[name]} from covering ${lost.join(', ')}`);
    if (old.blocks && !now.blocks) reasons.push(`let ${what[name]} give way when it fails (onFailure)`);
  }
  return reasons;
}
