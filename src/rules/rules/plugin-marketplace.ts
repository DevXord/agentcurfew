import type { Fact, PluginsKnowledge } from '../../knowledge/types.ts';
import { agentsOf } from '../knowledge.ts';
import { quote } from '../mask.ts';
import { entryValue, isRecord } from '../text.ts';
import type { Level, Rule, RuleHit } from '../types.ts';

function pluginFacts(plugins: Fact<PluginsKnowledge>): PluginsKnowledge[] {
  return plugins.status === 'disputed' ? plugins.variants.map((variant) => variant.value) : [plugins.value];
}

/** Where a remote source comes from, safe to print: a GitHub owner/repo, or the scheme and host of an address. */
function origin(source: Record<string, unknown>, urlField: string | undefined): string {
  const repo = source.repo;
  if (typeof repo === 'string') return `GitHub ${quote(repo, 80)}`;
  const url = urlField === undefined ? undefined : source[urlField];
  if (typeof url !== 'string') return 'a source that names no address';
  try {
    const parsed = new URL(url);
    return quote(`${parsed.protocol}//${parsed.host}`, 80);
  } catch {
    return 'an address agentcurfew cannot read';
  }
}

export const pluginMarketplace: Rule = {
  id: 'plugin-marketplace',
  title: 'Plugins from a marketplace the repository registers',
  level: 'medium',
  owasp: ['AST02', 'AST07'],
  description:
    "Finds plugin marketplaces registered in agent settings (Claude Code's extraKnownMarketplaces, also written additionalMarketplaces) and plugins they turn on (enabledPlugins). A marketplace from a GitHub repository, a git server or an address brings plugins with their own hooks, MCP servers and skills, which can change upstream without any change in this repository, and which the lockfile cannot pin; with autoUpdate they are updated in the background. In a project file the marketplace is registered for everyone who trusts the folder, and a plugin it holds by a relative path loads without an install.",
  levels: 'high for a marketplace that updates its plugins on its own or is fetched over plain http://; low for a marketplace on a local path and for a plugin a project file turns on; info in a user or machine file',
  fix: 'Remove the marketplace from the project settings, or pin it to a tag (ref) you have reviewed and turn autoUpdate off. Let each developer add marketplaces in their own user settings, and review the plugins before they are turned on.',
  example: '"extraKnownMarketplaces": { "tools": { "source": { "source": "github", "repo": "acme/plugins" }, "autoUpdate": true } }',
  kinds: ['setting'],
  check(component, context) {
    const value = entryValue(component);
    const hits: RuleHit[] = [];
    const seen = new Set<string>();
    const add = (message: string, level: Level): void => {
      const hit: RuleHit = component.scope === 'project' ? { message, level } : { message: `${message}, in every project of this user`, level: 'info' };
      if (seen.has(hit.message)) return;
      seen.add(hit.message);
      hits.push(hit);
    };
    for (const agent of agentsOf(component, context.knowledge)) {
      if (agent.plugins === undefined) continue;
      for (const plugins of pluginFacts(agent.plugins)) {
        const trust = component.scope === 'project' && plugins.marketplacesFromProject === 'needs-trust' ? ' once the folder is trusted' : '';
        if (component.name.startsWith(`${plugins.enabledKey}.`)) {
          if (value !== true) continue;
          const plugin = quote(component.name.slice(plugins.enabledKey.length + 1), 80);
          add(`turns on the plugin ${plugin} for ${agent.name}; a plugin its marketplace holds by a relative path loads without an install`, 'low');
          continue;
        }
        const key = plugins.marketplacesKeys.find((candidate) => component.name.startsWith(`${candidate}.`));
        if (key === undefined) continue;
        const name = quote(component.name.slice(key.length + 1), 80);
        const source = isRecord(value) && isRecord(value.source) ? value.source : undefined;
        const type = source?.source;
        const known = typeof type === 'string' ? plugins.sources.find((candidate) => candidate.type === type) : undefined;
        if (source === undefined || known === undefined) {
          add(`registers the marketplace ${name} for ${agent.name}${trust}, with a source agentcurfew does not know`, 'medium');
          continue;
        }
        if (known.where === 'local') {
          add(`registers the marketplace ${name} for ${agent.name}${trust}, from a local path`, 'low');
          continue;
        }
        if (known.where === 'inline') {
          add(`declares the marketplace ${name} for ${agent.name}${trust} inline, with plugins from sources outside this repository`, 'medium');
          continue;
        }
        const from = origin(source, known.urlField);
        const address = known.urlField === undefined ? undefined : source[known.urlField];
        const plain = typeof address === 'string' && /^http:\/\//i.test(address);
        const updates = isRecord(value) && value[plugins.autoUpdateField] === true;
        const extra = [plain ? 'fetched over plain http://, which anyone on the network path can change' : '', updates ? `with ${plugins.autoUpdateField}, so its plugins are updated in the background without a review` : ''].filter((part) => part !== '');
        add(`registers the marketplace ${name} for ${agent.name}${trust}, from ${from}${extra.length > 0 ? `, ${extra.join(', and ')}` : '; its plugins can change without a change in this repository'}`, plain || updates ? 'high' : 'medium');
      }
    }
    return hits;
  },
};
