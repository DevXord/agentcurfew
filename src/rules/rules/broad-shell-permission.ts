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

export const broadShellPermission: Rule = {
  id: 'broad-shell-permission',
  title: 'Every shell command allowed without a prompt',
  level: 'medium',
  owasp: ['AST03'],
  description:
    'Finds allow lists that let an agent run any shell command without asking: Bash or Bash(*) in Claude Code\'s permissions.allow, a bare run_shell_command in Gemini CLI\'s tools.allowed, and a skill whose allowed-tools frontmatter grants the whole shell. A prompt injection in any file the agent reads can then run commands on the machine.',
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
    if (component.kind === 'permission') {
      const value = entryValue(component);
      if (!Array.isArray(value)) return [];
      for (const { agent, entry } of allowAll) {
        if (keyMatches(component.name, entry.key) && value.includes(entry.value)) {
          add(`${quote(entry.value, 40)} in ${quote(component.name, 60)} lets ${agent.name} run any shell command without asking`, component.scope === 'project' ? undefined : 'low');
        }
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
      }
    }
    return hits;
  },
};
