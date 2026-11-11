import { parseFrontmatter } from '../../inventory/frontmatter.ts';
import { quote } from '../mask.ts';
import { agentsOf, keyMatches, permissionFacts, skillFacts } from '../knowledge.ts';
import { entryValue, isRecord } from '../text.ts';
import type { Rule, RuleHit } from '../types.ts';

/** Tool names from a space- or comma-separated string or a list, keeping spaces inside parentheses. */
export function toolList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => (typeof item === 'string' ? toolList(item) : []));
  if (typeof value !== 'string') return [];
  const tools: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === ',' || /\s/.test(char))) {
      if (current !== '') tools.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current !== '') tools.push(current);
  return tools;
}

// Programs that run whatever they are given: a shell, an interpreter, or a launcher that fetches and runs a package.
// Allowing one with any arguments (Bash(npx *), Bash(node:*), run_shell_command(sh)) allows every command through it.
const RUNNERS = new Set([
  'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd', 'env', 'timeout', 'xargs', 'nohup', 'nice', 'sudo', 'doas', 'eval', 'exec',
  'npx', 'bunx', 'pnpx', 'pnx', 'node', 'deno', 'bun', 'python', 'python3', 'perl', 'ruby', 'php', 'uvx', 'pipx',
  'pnpm dlx', 'pnpm exec', 'pn dlx', 'pn exec', 'npm exec', 'npm x', 'npm exe', 'yarn dlx', 'go run', 'uv run', 'uv tool run',
]);

/** The runner an entry such as Bash(npx *) allows with any arguments, when its tool is one that runs shell commands. */
function runnerOf(entry: string, shellTools: ReadonlySet<string>): string | undefined {
  const call = /^([\w-]+)\((.*)\)$/s.exec(entry.trim());
  if (call === null || !shellTools.has((call[1] ?? '').toLowerCase())) return undefined;
  const inner = (call[2] ?? '').trim();
  const words = inner.split(/[\s:]+/).filter((word) => word !== '');
  for (const length of [3, 2, 1]) {
    const head = words.slice(0, length);
    if (head.length < length) continue;
    const last = head[length - 1] as string;
    // The runner with a wildcard joined to it: Bash(npx*) runs npx with anything (field test of 2026-11-09).
    if (last.endsWith('*') && RUNNERS.has([...head.slice(0, -1), last.replace(/\*+$/, '')].join(' '))) return [...head.slice(0, -1), last.replace(/\*+$/, '')].join(' ');
    const runner = head.join(' ');
    if (!RUNNERS.has(runner)) continue;
    const next = words[length];
    // The runner alone, where an entry is a prefix (run_shell_command(sh)), or a wildcard right after it (Bash(node:*)).
    if (next === undefined || next.startsWith('*')) return runner;
    // Options of the runner, then a wildcard: Bash(npx -y *), Bash(sh -c:*).
    if (next.startsWith('-')) return words.slice(length).some((word) => word.includes('*')) ? runner : undefined;
    // A program after the runner fixes what runs: Bash(pnpx vitest:*), Bash(xargs kill:*).
    return undefined;
  }
  return undefined;
}

export const broadShellPermission: Rule = {
  id: 'broad-shell-permission',
  title: 'Every shell command allowed without a prompt',
  level: 'medium',
  owasp: ['AST03'],
  description:
    'Finds allow lists that let an agent run any shell command without asking: Bash or Bash(*) in Claude Code\'s permissions.allow, a bare run_shell_command in Gemini CLI\'s tools.allowed, a skill whose allowed-tools frontmatter grants the whole shell, and entries that allow a shell, an interpreter or a package launcher with any arguments (Bash(npx *), Bash(node:*), Bash(sh:*)), which runs every command through it. A prompt injection in any file the agent reads can then run commands on the machine.',
  levels: 'low in a user or machine file, which applies only to that user',
  fix: 'List the commands that are needed, such as Bash(npm test) or run_shell_command(git), instead of the whole tool.',
  example: '"permissions": { "allow": ["Bash"] } in .claude/settings.json',
  kinds: ['permission', 'skill'],
  check(component, context) {
    const hits: RuleHit[] = [];
    const seen = new Set<string>();
    const add = (message: string, level?: RuleHit['level']): void => {
      if (seen.has(message)) return;
      seen.add(message);
      hits.push(level === undefined ? { message } : { message, level });
    };
    const agents = agentsOf(component, context.knowledge);
    const allowAll = agents.flatMap((agent) => permissionFacts(agent).flatMap((permissions) => (permissions.allowAllShell ?? []).map((entry) => ({ agent, entry }))));
    // The tools that run shell commands, from the allow-all entries: Bash for Bash(*), run_shell_command, exec.
    const shellTools = new Set(allowAll.map(({ entry }) => entry.value.replace(/\(.*$/s, '').toLowerCase()));
    const runner = (entry: string, where: string, agent: string | undefined, level?: RuleHit['level']): void => {
      const found = runnerOf(entry, shellTools);
      if (found !== undefined) add(`${quote(entry, 60)} in ${where} allows ${quote(found, 20)} with any arguments, which lets ${agent ?? 'the agent'} run any command through it without asking`, level);
    };
    if (component.kind === 'permission') {
      const value = entryValue(component);
      if (!Array.isArray(value)) return [];
      for (const { agent, entry } of allowAll) {
        if (!keyMatches(component.name, entry.key)) continue;
        if (value.includes(entry.value)) {
          add(`${quote(entry.value, 40)} in ${quote(component.name, 60)} lets ${agent.name} run any shell command without asking`, component.scope === 'project' ? undefined : 'low');
          continue;
        }
        for (const item of value) if (typeof item === 'string') runner(item, quote(component.name, 60), agent.name, component.scope === 'project' ? undefined : 'low');
      }
      return hits;
    }
    const frontmatter = parseFrontmatter(component.raw);
    if (frontmatter.status !== 'ok' || !isRecord(frontmatter.value)) return [];
    const fields = new Set(agents.flatMap((agent) => skillFacts(agent).flatMap((skills) => (skills.grantsField === undefined ? [] : [skills.grantsField]))));
    const everything = new Set(allowAll.map(({ entry }) => entry.value));
    for (const field of fields) {
      for (const tool of toolList(frontmatter.value[field])) {
        if (everything.has(tool)) add(`${field} grants ${quote(tool, 40)}, so the skill can run any shell command without asking`);
        else runner(tool, field, 'the skill');
      }
    }
    return hits;
  },
};
