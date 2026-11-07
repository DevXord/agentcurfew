import { homedir } from 'node:os';
import { claudeCode } from '../knowledge/claude-code.ts';
import type { ToolHookKnowledge } from '../knowledge/types.ts';
import { readPolicy } from '../policy/read.ts';
import { POLICY_FILE } from '../policy/types.ts';
import { checkCommand } from './bash.ts';
import { afterEdit, checkWrite, readCurrent, TOO_LARGE } from './files.ts';
import { combine } from './types.ts';
import type { Verdict } from './types.ts';

/** The largest hook input read; a tool call with more input than this is not judged. */
export const MAX_HOOK_INPUT = 4 * 1024 * 1024;

function hookFact(): ToolHookKnowledge {
  const fact = claudeCode.toolHook;
  if (fact === undefined) throw new Error('the knowledge base has no tool hook for Claude Code');
  return fact.status === 'disputed' ? fact.variants[0].value : fact.value;
}

function field(value: unknown, name: string | undefined): unknown {
  if (name === undefined || typeof value !== 'object' || value === null) return undefined;
  return Object.hasOwn(value, name) ? (value as Record<string, unknown>)[name] : undefined;
}

function nest(dotted: string, value: unknown): Record<string, unknown> {
  const parts = dotted.split('.');
  let result: unknown = value;
  for (const part of parts.reverse()) result = { [part]: result };
  return result as Record<string, unknown>;
}

function merge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    target[key] = typeof existing === 'object' && existing !== null && typeof value === 'object' && value !== null ? merge(existing as Record<string, unknown>, value as Record<string, unknown>) : value;
  }
  return target;
}

/**
 * The verdict on one PreToolUse input; undefined when the call is none of the hook's business. While the project's policy
 * is invalid, it cannot be applied, so a call the hook has an opinion on is denied, except a write of the policy itself,
 * which is how it gets fixed.
 */
export function judge(input: unknown, root: string, now?: Date, home: string = homedir()): Verdict | undefined {
  const verdict = judgeCall(input, root, now, home);
  if (verdict === undefined || verdict.decision === 'deny') return verdict;
  if (readPolicy(root).status !== 'invalid' || verdict.reasons.some((reason) => reason.includes(POLICY_FILE))) return verdict;
  return { decision: 'deny', reasons: [...verdict.reasons, `agentcurfew: ${POLICY_FILE} does not follow the schema, so the policy could not be applied; fix it first (agentcurfew doctor lists the problems).`] };
}

function judgeCall(input: unknown, root: string, now?: Date, home: string = homedir()): Verdict | undefined {
  const hook = hookFact();
  const tool = field(input, hook.toolNameField);
  const toolInput = field(input, hook.toolInputField);
  if (typeof tool !== 'string') return undefined;
  const fields = Object.hasOwn(hook.tools, tool) ? hook.tools[tool] : undefined;
  if (fields === undefined) {
    // A tool that writes files but whose input the knowledge base does not describe (NotebookEdit, or one added later):
    // when it names a file that steers an agent, the change cannot be checked, so ask.
    if (!/edit|write/i.test(tool)) return undefined;
    const named = ['file_path', 'notebook_path', 'path'].map((name) => field(toolInput, name)).find((value): value is string => typeof value === 'string' && value !== '');
    return named === undefined ? undefined : checkWrite(named, { why: `agentcurfew cannot read the input of the tool ${tool.slice(0, 40).replace(/[^\w-]/g, '?')}` }, root, now, home);
  }
  if (fields.command !== undefined) {
    const command = field(toolInput, fields.command);
    if (typeof command !== 'string') return undefined;
    const policy = readPolicy(root);
    return combine(checkCommand(command, policy.status === 'ok' ? policy.policy : undefined));
  }
  const file = field(toolInput, fields.path);
  if (typeof file !== 'string' || file === '') return undefined;
  let text: string | { why: string };
  if (fields.content !== undefined) {
    const content = field(toolInput, fields.content);
    text = typeof content === 'string' ? content : { why: 'the new content is missing' };
  } else {
    const oldText = field(toolInput, fields.oldText);
    const newText = field(toolInput, fields.newText);
    if (typeof oldText !== 'string' || typeof newText !== 'string') {
      text = { why: 'the edit is incomplete' };
    } else {
      const current = readCurrent(file, root);
      // A file past the read limit cannot be checked after the edit either: the same padding as in a Write.
      const edited = current === TOO_LARGE ? { why: 'the file is larger than agentcurfew reads', deny: true } : afterEdit(current, oldText, newText, field(toolInput, fields.replaceAll) === true);
      text = 'text' in edited ? edited.text : edited;
    }
  }
  return checkWrite(file, text, root, now, home);
}

/**
 * agentcurfew hook: reads one PreToolUse input and prints the decision JSON, or nothing when it has no opinion. It never
 * allows: silence leaves the call to the agent's own permission flow and to other hooks, such as depcurfew's.
 */
export function runHook(stdin: string, env: Readonly<Record<string, string | undefined>>, cwd: string, now?: Date): { stdout: string; stderr: string } {
  const hook = hookFact();
  // A tool call too large to read may be a padded write to an agent file, so it is denied rather than let through.
  if (Buffer.byteLength(stdin) > MAX_HOOK_INPUT) return answer(hook, { decision: 'deny', reasons: ['agentcurfew: this tool call is larger than the 4 MB agentcurfew reads, so it could not be checked.'] });
  let input: unknown;
  try {
    input = JSON.parse(stdin) as unknown;
  } catch {
    return { stdout: '', stderr: 'agentcurfew hook: the input is not JSON, so it was not checked\n' };
  }
  const fromInput = field(input, 'cwd');
  const root = env[hook.projectDirVariable] ?? (typeof fromInput === 'string' ? fromInput : cwd);
  let verdict: Verdict | undefined;
  try {
    verdict = judge(input, root, now, env.HOME ?? env.USERPROFILE ?? homedir());
  } catch {
    const tool = field(input, hook.toolNameField);
    if (tool === 'Write' || tool === 'Edit') verdict = { decision: 'ask', reasons: ['agentcurfew: this write could not be checked because of an error in agentcurfew.'] };
    else return { stdout: '', stderr: 'agentcurfew hook: the check failed, so it gives no opinion\n' };
  }
  if (verdict === undefined) return { stdout: '', stderr: '' };
  return answer(hook, verdict);
}

function answer(hook: ToolHookKnowledge, verdict: Verdict): { stdout: string; stderr: string } {
  const output = merge(merge(nest(hook.eventNameField, 'PreToolUse'), nest(hook.decisionField, verdict.decision)), nest(hook.reasonField, verdict.reasons.join(' ')));
  return { stdout: `${JSON.stringify(output)}\n`, stderr: '' };
}
