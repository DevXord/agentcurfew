import { stripJsonc } from '../inventory/parse.ts';
import { claudeCode } from '../knowledge/claude-code.ts';
import type { ToolHookKnowledge } from '../knowledge/types.ts';

function hookFact(): ToolHookKnowledge {
  const fact = claudeCode.toolHook;
  if (fact === undefined) throw new Error('the knowledge base has no tool hook for Claude Code');
  return fact.status === 'disputed' ? fact.variants[0].value : fact.value;
}

/** The file the hook is written to: the project settings of Claude Code, shared through the repository. */
export const HOOK_SETTINGS = '.claude/settings.json';

/** The hook entry, with the tools of the knowledge base and the project directory variable of Claude Code. */
export function hookEntry(): { matcher: string; hooks: { type: 'command'; command: string; args: string[]; timeout: number }[] } {
  const fact = hookFact();
  // With args, Claude Code spawns the program without a shell (knowledge base, hooks fact), as depcurfew's hook does.
  return {
    matcher: [...Object.keys(fact.tools), ...(fact.otherWriteTools ?? [])].join('|'),
    hooks: [{ type: 'command', command: 'node', args: [`\${${fact.projectDirVariable}}/node_modules/agentcurfew/dist/cli.js`, 'hook'], timeout: 30 }],
  };
}

/** Whether a hook command is agentcurfew's own. */
export function isOwnHook(command: string): boolean {
  return /agentcurfew(?:\/dist\/cli\.js["']?)?\s+hook\b/.test(command) || /\bacf\s+hook\b/.test(command);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type InstallResult =
  | { status: 'added' | 'present'; text: string; others: string[] }
  | { status: 'refused'; reason: string };

/**
 * The settings with agentcurfew's hook added under hooks.PreToolUse, every other key and hook kept as it was, depcurfew's
 * included. Nothing is added when the hook is already there. Settings with comments are refused, since writing them back
 * would drop the comments.
 */
export function addHook(current: string | undefined): InstallResult {
  const text = current ?? '{}';
  if (stripJsonc(text) !== text) return { status: 'refused', reason: 'it has comments, which would be lost' };
  let settings: unknown;
  try {
    settings = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
  } catch {
    return { status: 'refused', reason: 'it is not valid JSON' };
  }
  if (!isRecord(settings)) return { status: 'refused', reason: 'it is not a JSON object' };
  const [, eventName] = hookFact().settingsKey.split('.') as [string, string];
  const hooks = settings.hooks ?? {};
  if (!isRecord(hooks)) return { status: 'refused', reason: 'its hooks field is not an object' };
  const groups = hooks[eventName] ?? [];
  if (!Array.isArray(groups)) return { status: 'refused', reason: `its hooks.${eventName} field is not a list` };
  const commands = groups
    .flatMap((group: unknown) => (isRecord(group) && Array.isArray(group.hooks) ? group.hooks : []))
    .flatMap((handler: unknown) => (isRecord(handler) && typeof handler.command === 'string' ? [[handler.command, ...(Array.isArray(handler.args) ? handler.args.filter((arg): arg is string => typeof arg === 'string') : [])].join(' ')] : []));
  const others = commands.filter((command) => !isOwnHook(command));
  if (commands.some(isOwnHook)) return { status: 'present', text, others };
  const updated = { ...settings, hooks: { ...hooks, [eventName]: [...groups, hookEntry()] } };
  return { status: 'added', text: `${JSON.stringify(updated, null, 2)}\n`, others };
}
