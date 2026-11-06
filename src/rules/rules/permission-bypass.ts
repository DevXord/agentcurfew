import { quote } from '../mask.ts';
import { agentsOf, keyMatches, permissionFacts } from '../knowledge.ts';
import { entryValue } from '../text.ts';
import type { Rule, RuleHit } from '../types.ts';

function holds(value: unknown, wanted: string | boolean): boolean {
  if (Array.isArray(value)) return value.some((item) => item === wanted);
  return value === wanted;
}

export const permissionBypass: Rule = {
  id: 'permission-bypass',
  title: 'Setting that turns approval prompts off',
  level: 'high',
  owasp: ['AST03'],
  description:
    'Finds settings that let an agent act without asking, as the knowledge base lists them for each agent: for example Claude Code\'s defaultMode bypassPermissions, Codex\'s sandbox_mode danger-full-access or approval_policy never, Cursor\'s mcpAllowlist *:*, VS Code\'s chat.tools.global.autoApprove and Gemini CLI\'s trust on an MCP server. In a project file it applies to everyone who opens the repository. Where the agent ignores the setting in a project file, the finding is low and says so.',
  fix: 'Remove the setting from the project. Grant narrow permissions for the commands and tools that are needed instead, and let each developer decide about broader ones in their own user settings.',
  example: 'sandbox_mode = "danger-full-access" in .codex/config.toml',
  kinds: ['permission'],
  check(component, context) {
    const value = entryValue(component);
    if (value === undefined) return [];
    const hits: RuleHit[] = [];
    const seen = new Set<string>();
    for (const agent of agentsOf(component, context.knowledge)) {
      for (const permissions of permissionFacts(agent)) {
        for (const setting of permissions.bypass) {
          if (!keyMatches(component.name, setting.key) || !holds(value, setting.value)) continue;
          const fact = agent.permissions;
          const settled =
            fact.status === 'verified' ||
            (fact.status === 'disputed' && fact.variants.every((variant) => variant.value?.bypass.some((other) => other.key === setting.key && other.value === setting.value) === true));
          const doubt = settled ? '' : '; the knowledge base marks this fact as not settled';
          const what = `${quote(component.name, 80)} = ${quote(String(setting.value), 40)}`;
          let hit: RuleHit;
          if (component.scope !== 'project') {
            hit = { message: `${what} turns prompts off for ${agent.name} in every project of this user${doubt}`, level: 'low' };
          } else if (setting.fromProject === 'ignored') {
            hit = { message: `${what} would turn prompts off for ${agent.name}; current versions ignore it in a project file, older ones may not${doubt}`, level: 'low' };
          } else if (setting.fromProject === 'needs-trust') {
            hit = { message: `${what} turns prompts off for ${agent.name} once the folder is trusted${doubt}` };
          } else {
            hit = { message: `${what} turns prompts off for ${agent.name}${doubt}` };
          }
          if (seen.has(hit.message)) continue;
          seen.add(hit.message);
          hits.push(hit);
        }
      }
    }
    return hits;
  },
};
