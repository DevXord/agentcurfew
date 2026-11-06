import type { Inventory } from '../inventory/types.ts';
import type { AgentKnowledge } from '../knowledge/types.ts';
import { isExecutable, serverIdentity } from '../lock/build.ts';
import type { SkillsLockRead } from '../lock/skills-lock.ts';
import type { Finding } from '../rules/types.ts';
import type { Policy } from './types.ts';
import { SCHEMA_URL } from './types.ts';

export interface Proposal {
  policy: Policy;
  /** Settings left loose because the project does not meet the strict value yet, and why. */
  loosened: string[];
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A policy that the project passes as it is: the skill sources and servers it has now, and the strict value of every
 * setting the findings allow. A setting the project breaks today is set loose and listed, so that it can be tightened.
 */
export function proposePolicy(inventory: Inventory, findings: readonly Finding[], skillsLock: SkillsLockRead | undefined, knowledge: readonly AgentKnowledge[]): Proposal {
  const project = inventory.components.filter((component) => component.scope === 'project');
  const entries = skillsLock?.status === 'ok' ? skillsLock.entries : [];
  const sources: string[] = [];
  let executables = false;
  for (const skill of project.filter((component) => component.kind === 'skill')) {
    const entry = entries.find((candidate) => candidate.name === skill.name && candidate.source !== '');
    sources.push(entry === undefined ? 'local' : entry.source);
    if ((skill.files ?? []).some(isExecutable)) executables = true;
  }
  const servers: string[] = [];
  for (const server of project.filter((component) => component.kind === 'mcp-server')) {
    const { names, local } = serverIdentity(server, knowledge);
    servers.push(...names, ...(local ? ['local'] : []));
  }
  const has = (rule: string, tag?: string) => findings.some((finding) => finding.rule === rule && (tag === undefined || finding.tag === tag));
  const loosened: string[] = [];
  const strict = (field: string, broken: boolean, strictValue: boolean, why: string): boolean => {
    if (broken) loosened.push(`${field} is ${!strictValue}: ${why}`);
    return broken ? !strictValue : strictValue;
  };
  const policy: Policy = {
    $schema: SCHEMA_URL,
    version: 1,
    failOn: 'high',
    skills: {
      allowSources: sorted(sources),
      allowExecutables: strict('skills.allowExecutables', executables, false, 'a skill bundles programs or scripts'),
    },
    mcp: {
      requirePinnedVersions: strict('mcp.requirePinnedVersions', has('unpinned-mcp-server'), true, 'a server has no fixed version'),
      allowServers: sorted(servers),
      denyPlainHttp: strict('mcp.denyPlainHttp', has('plain-http-mcp'), true, 'a server is reached without TLS'),
    },
    hooks: {
      allowNetwork: strict('hooks.allowNetwork', has('dangerous-hook-command', 'network'), false, 'a hook opens a network connection'),
      allowAutoRunOnOpen: strict('hooks.allowAutoRunOnOpen', has('auto-run-on-open'), false, 'something starts without a user action'),
    },
    contextFiles: {
      denyHiddenUnicode: strict('contextFiles.denyHiddenUnicode', has('hidden-unicode'), true, 'a file holds hidden characters; remove them rather than keep this'),
    },
    exclude: [],
    exceptions: [],
  };
  return { policy, loosened };
}

/** The policy as written by init: the schema's order of fields, 2-space indent, a final newline. */
export function serializePolicy(policy: Policy): string {
  return `${JSON.stringify(policy, null, 2)}\n`;
}
