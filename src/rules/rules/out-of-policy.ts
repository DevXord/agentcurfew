import { isExecutable, serverIdentity } from '../../lock/build.ts';
import { globMatch } from '../../policy/glob.ts';
import { quote } from '../mask.ts';
import type { ProjectHit, Rule } from '../types.ts';

const LOCAL = 'local';
const MAX_LISTED = 5;

/** Whether a name (a package, image, source or address) matches one of the globs of a policy list. */
export function allowedBy(list: readonly string[], name: string): boolean {
  return list.some((glob) => glob !== LOCAL && globMatch(glob, name));
}

export const outOfPolicy: Rule = {
  id: 'out-of-policy',
  title: 'Skill source or MCP server not allowed by the policy',
  level: 'high',
  owasp: ['AST09'],
  description:
    'Checks the project against the lists of agentcurfew.policy.json: skills whose source in skills-lock.json is not in skills.allowSources (medium when the skill is not in skills-lock.json at all, so its source is unknown), skills that bundle programs or scripts when skills.allowExecutables is false, and MCP servers whose package, image or address is not in mcp.allowServers. Without a policy, or without the list, it checks nothing.',
  fix: 'Remove the component, or, if it was reviewed and is wanted, add its source, package or address to the policy. local allows skills that skills-lock.json does not list and servers started from a local command.',
  example: 'mcp.allowServers is ["@modelcontextprotocol/*"], and .mcp.json starts npx -y random-server@1.0.0',
  kinds: [],
  check: () => [],
  checkProject(inventory, context) {
    const policy = context.policy;
    if (policy === undefined) return [];
    const hits: ProjectHit[] = [];
    const sources = policy.skills?.allowSources;
    const entries = context.skillsLock?.status === 'ok' ? context.skillsLock.entries : [];
    for (const component of inventory.components) {
      if (component.scope !== 'project') continue;
      const place = { kind: component.kind, file: component.file, name: component.name };
      if (component.kind === 'skill') {
        if (sources !== undefined) {
          const entry = entries.find((candidate) => candidate.name === component.name);
          if (entry === undefined || entry.source === '') {
            if (!sources.includes(LOCAL)) hits.push({ ...place, message: 'not listed in skills-lock.json, so its source is unknown, and skills.allowSources does not allow local skills', level: 'medium' });
          } else if (!allowedBy(sources, entry.source)) {
            hits.push({ ...place, message: `comes from ${quote(entry.source, 80)}, which skills.allowSources does not list` });
          }
        }
        if (policy.skills?.allowExecutables === false) {
          const executables = (component.files ?? []).filter(isExecutable).map((file) => file.path).sort();
          if (executables.length > 0) {
            const shown = executables.slice(0, MAX_LISTED).map((path) => quote(path, 60)).join(', ');
            const more = executables.length > MAX_LISTED ? ` and ${executables.length - MAX_LISTED} more` : '';
            hits.push({ ...place, message: `bundles programs or scripts (${shown}${more}), and skills.allowExecutables is false` });
          }
        }
      }
      const servers = policy.mcp?.allowServers;
      if (component.kind === 'mcp-server' && servers !== undefined) {
        const { names, local } = serverIdentity(component, context.knowledge);
        if (local) {
          if (!servers.includes(LOCAL)) hits.push({ ...place, message: 'starts a local command, and mcp.allowServers does not allow local servers' });
        } else if (names.length === 0) {
          hits.push({ ...place, message: 'neither its package nor its address could be read, so mcp.allowServers cannot allow it' });
        } else if (!names.some((name) => allowedBy(servers, name))) {
          hits.push({ ...place, message: `${names.map((name) => quote(name, 80)).join(' and ')} is not listed in mcp.allowServers` });
        }
      }
    }
    return hits;
  },
};
