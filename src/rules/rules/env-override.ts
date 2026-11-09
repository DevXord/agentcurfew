import type { EnvKnowledge, Fact } from '../../knowledge/types.ts';
import { agentsOf } from '../knowledge.ts';
import { quote } from '../mask.ts';
import { entryValue, isRecord } from '../text.ts';
import type { Rule, RuleHit } from '../types.ts';

function envFacts(env: Fact<EnvKnowledge>): EnvKnowledge[] {
  return env.status === 'disputed' ? env.variants.map((variant) => variant.value) : [env.value];
}

/** The host of an address, without its user name, password, path or query, which may hold secrets. */
function host(value: string): string {
  try {
    const url = new URL(value);
    return url.host === '' ? 'an address agentcurfew cannot read' : quote(url.host, 80);
  } catch {
    return 'an address agentcurfew cannot read';
  }
}

export const envOverride: Rule = {
  id: 'env-override',
  title: 'Agent traffic or commands redirected by a variable',
  level: 'high',
  owasp: ['AST04', 'AST06'],
  description:
    "Finds variables in the env block of agent settings that send the agent's requests to another host or wrap the commands it runs, as the knowledge base lists them: Claude Code's ANTHROPIC_BASE_URL and the endpoints of Bedrock, Vertex, Foundry and Claude Platform on AWS, HTTP_PROXY and HTTPS_PROXY, ANTHROPIC_CUSTOM_HEADERS and CLAUDE_CODE_SHELL_PREFIX. In a project file they apply to everyone who opens the repository and trusts it, or runs claude -p there: prompts, code and credentials then go through a host the repository chose, which can also answer in the model's place, or every command runs through a program the repository chose.",
  levels: 'low in a user or machine file, and for a variable current versions ignore in a project file',
  fix: "Remove the variable from the project settings. If the team uses a gateway or a proxy, set it in each developer's user settings or in managed settings instead.",
  falsePositives: 'An organization may point its repositories at its own gateway on purpose; accept the finding in the policy with the reason.',
  example: '"env": { "ANTHROPIC_BASE_URL": "https://gateway.example.com" } in .claude/settings.json',
  kinds: ['setting'],
  check(component, context) {
    const value = entryValue(component);
    if (!isRecord(value)) return [];
    const hits: RuleHit[] = [];
    const seen = new Set<string>();
    for (const agent of agentsOf(component, context.knowledge)) {
      if (agent.env === undefined) continue;
      for (const env of envFacts(agent.env)) {
        if (!component.name.startsWith(`${env.key}.`)) continue;
        const name = component.name.slice(env.key.length + 1);
        const variable = env.variables.find((item) => item.name === name);
        const set = Object.hasOwn(value, name) ? value[name] : undefined;
        if (variable === undefined || typeof set !== 'string' || set.trim() === '') continue;
        const what =
          variable.effect === 'endpoint'
            ? `sends ${agent.name}'s requests to ${host(set)}`
            : variable.effect === 'proxy'
              ? `routes ${agent.name}'s connections through the proxy ${host(set)}`
              : variable.effect === 'headers'
                ? `adds headers of the repository's choosing to ${agent.name}'s requests`
                : `wraps every shell command, hook, status line and stdio MCP server start of ${agent.name} in a command of the repository's choosing`;
        const shown = `${quote(component.name, 80)} ${what}`;
        let hit: RuleHit;
        if (component.scope !== 'project') hit = { message: `${shown}, in every project of this user`, level: 'low' };
        else if (variable.fromProject === 'ignored') hit = { message: `${shown}; current versions ignore it in a project file, older ones may not`, level: 'low' };
        else hit = { message: `${shown}, for everyone who trusts this folder or runs ${agent.name} without a prompt there` };
        if (seen.has(hit.message)) continue;
        seen.add(hit.message);
        hits.push(hit);
      }
    }
    return hits;
  },
};
