import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Component } from '../inventory/types.ts';
import { parseConfig } from '../inventory/parse.ts';
import { serverIdentity } from '../lock/build.ts';
import { canonicalJson } from '../lock/hash.ts';
import { globMatch } from '../policy/glob.ts';
import { SCHEMA_URL } from '../policy/types.ts';
import { quote } from '../rules/mask.ts';
import { keyMatches } from '../rules/knowledge.ts';
import { entryValue, isRecord } from '../rules/text.ts';
import { distance } from '../text/distance.ts';
import { evidenceOf, knownPaths, mcpFacts } from './paths.ts';
import type { DoctorCheck, DoctorContext, DoctorHit } from './types.ts';

const JSON_SPEC = 'https://www.rfc-editor.org/rfc/rfc8259';
const TOML_SPEC = 'https://toml.io/en/v1.0.0';
const YAML_SPEC = 'https://yaml.org/spec/1.2.2/';
const CLAUDE_MCP = 'https://code.claude.com/docs/en/mcp';

const project = (context: DoctorContext) => context.analysis.inventory.components.filter((component) => component.scope === 'project');
const knowledge = (context: DoctorContext) => context.analysis.context.knowledge;

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

const EXTENSION_VARIANTS: Readonly<Record<string, readonly string[]>> = { '.json': ['.jsonc', '.json5'], '.toml': ['.tml'], '.md': ['.markdown', '.mdx', '.txt'] };

function stem(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? [name, ''] : [name.slice(0, dot), name.slice(dot)];
}

/** Why a file name is probably meant to be a known one, or undefined. */
function nearMiss(name: string, known: string): string | undefined {
  if (name === known) return undefined;
  if (name.toLowerCase() === known.toLowerCase()) return `differs from ${known} only in case, so agents on a case-sensitive file system do not read it`;
  const [nameStem, nameExtension] = stem(name);
  const [knownStem, knownExtension] = stem(known);
  if (nameStem === knownStem && (EXTENSION_VARIANTS[knownExtension] ?? []).includes(nameExtension)) return `has the extension ${nameExtension}, but agents read ${known}`;
  if (known.length >= 6 && nameExtension === knownExtension && distance(name, known, 2) <= 2) return `looks like a misspelling of ${known}, which is the name agents read`;
  return undefined;
}

export const invalidPolicy: DoctorCheck = {
  id: 'invalid-policy',
  title: 'agentcurfew.policy.json follows the schema',
  level: 'error',
  description: 'A policy that does not follow schema.json is not applied: agentcurfew scan, lock and verify stop instead of guessing what it meant. Every problem is listed with the path to the field.',
  fix: 'Correct each field named; the schema describes every setting, and editors that read $schema can check the file as it is typed.',
  sources: [SCHEMA_URL],
  applies: (context) => context.analysis.policy.status !== 'missing',
  run(context) {
    const policy = context.analysis.policy;
    if (policy.status !== 'invalid') return [];
    return policy.issues.map((issue) => ({ file: 'agentcurfew.policy.json', message: `${quote(issue.path, 120)}: ${issue.message}` }));
  },
};

export const unparsableConfig: DoctorCheck = {
  id: 'unparsable-config',
  title: 'Every agent configuration file can be parsed',
  level: 'error',
  description: 'Lists configuration files and frontmatter that are not valid JSON, TOML or YAML. agentcurfew reads nothing from such a file, so none of its components are checked or locked, and an agent that reads it may ignore all of it or refuse to start.',
  fix: 'Correct the syntax of the file; the agent\'s own error message usually names the line.',
  sources: [JSON_SPEC, TOML_SPEC, YAML_SPEC],
  applies: () => true,
  run: (context) =>
    context.analysis.inventory.problems
      .filter((problem) => problem.code === 'unparsable')
      .map((problem) => ({ file: problem.file, message: 'could not be parsed, so nothing in it was read', sources: [problem.file.endsWith('.toml') ? TOML_SPEC : /\.(?:md|mdc|markdown)$/i.test(problem.file) ? YAML_SPEC : JSON_SPEC] })),
};

export const misnamedFile: DoctorCheck = {
  id: 'misnamed-file',
  title: 'No file is named almost like one an agent reads',
  level: 'warning',
  description: 'Looks in the folders where agents read configuration (the project root, .claude, .cursor, .vscode, .gemini, .github and the others of the knowledge base) for files whose name is close to one an agent reads, but not the same: a different case, a different extension (.jsonc for .json) or one or two letters off. The agent ignores such a file without a word.',
  fix: 'Rename the file to the name the agent reads, or delete it.',
  sources: [],
  applies: () => true,
  run(context) {
    const byFolder = new Map<string, Map<string, string[]>>();
    for (const known of knownPaths(knowledge(context))) {
      if (known.entry.scope !== 'project' || known.entry.path.includes('*')) continue;
      const slash = known.entry.path.lastIndexOf('/');
      const folder = slash === -1 ? '' : known.entry.path.slice(0, slash);
      const name = known.entry.path.slice(slash + 1);
      const names = byFolder.get(folder) ?? new Map<string, string[]>();
      names.set(name, unique([...(names.get(name) ?? []), known.source]));
      byFolder.set(folder, names);
    }
    const hits: DoctorHit[] = [];
    for (const [folder, names] of [...byFolder].sort(([a], [b]) => (a < b ? -1 : 1))) {
      let entries: string[] = [];
      try {
        const path = join(context.root, folder);
        if (folder !== '' && lstatSync(path).isSymbolicLink()) continue;
        entries = readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
      } catch {
        continue;
      }
      for (const name of entries) {
        if (names.has(name)) continue;
        for (const [known, sources] of names) {
          const why = nearMiss(name, known);
          if (why === undefined) continue;
          hits.push({ file: folder === '' ? name : `${folder}/${name}`, message: `${quote(name, 80)} ${why}`, sources });
          break;
        }
      }
    }
    return hits;
  },
};

export const wrongServersKey: DoctorCheck = {
  id: 'wrong-servers-key',
  title: 'MCP files use the key their agents read',
  level: 'error',
  description: 'VS Code reads servers in .vscode/mcp.json, while .mcp.json and most other agents use mcpServers and Codex uses mcp_servers. A file written with the key of another format lists no server for the agents that read it.',
  fix: 'Rename the top-level key to the one the agent reads; the message names it.',
  sources: [],
  applies: () => true,
  run(context) {
    const expected = new Map<string, { keys: Set<string>; sources: Set<string>; agents: Set<string> }>();
    const allKeys = new Set<string>();
    for (const agent of knowledge(context)) {
      for (const { mcp, source } of mcpFacts(agent)) {
        allKeys.add(mcp.serversKey);
        for (const file of mcp.files) {
          const key = file.serversKey ?? mcp.serversKey;
          allKeys.add(key);
          if (file.scope !== 'project' || file.path.includes('*') || !['json', 'jsonc', 'toml'].includes(file.format)) continue;
          const item = expected.get(file.path) ?? { keys: new Set<string>(), sources: new Set<string>(), agents: new Set<string>() };
          item.keys.add(key);
          item.sources.add(source);
          item.agents.add(agent.name);
          expected.set(file.path, item);
        }
      }
    }
    const hits: DoctorHit[] = [];
    for (const [path, { keys, sources, agents }] of [...expected].sort(([a], [b]) => (a < b ? -1 : 1))) {
      let text: string;
      try {
        const full = join(context.root, path);
        if (lstatSync(full).isSymbolicLink()) continue;
        text = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const value = parseConfig(text, path.endsWith('.toml') ? 'toml' : 'json');
      if (!isRecord(value)) continue;
      if ([...keys].some((key) => key.includes('<') || Object.hasOwn(value, key))) continue;
      const wrong = [...allKeys].filter((key) => !key.includes('<') && !key.includes('.') && Object.hasOwn(value, key) && isRecord(value[key]));
      if (wrong.length === 0) continue;
      hits.push({ file: path, message: `holds ${wrong.join(', ')}, but ${[...agents].sort().join(', ')} ${agents.size === 1 ? 'reads' : 'read'} ${[...keys].sort().join(' or ')} here, so no server is configured`, sources: [...sources] });
    }
    return hits;
  },
};

export const missingMcpType: DoctorCheck = {
  id: 'missing-mcp-type',
  title: 'Remote servers in .mcp.json say their type',
  level: 'error',
  description: 'Claude Code reads an entry of .mcp.json with no type as a local stdio server, so a remote server given only a url never connects. The knowledge base records this from the MCP page of Claude Code.',
  fix: 'Add "type": "http" (or "sse" for an older server) to the entry.',
  sources: [CLAUDE_MCP],
  applies: (context) => project(context).some((component) => component.kind === 'mcp-server' && component.file === '.mcp.json'),
  run(context) {
    return project(context)
      .filter((component) => component.kind === 'mcp-server' && component.file === '.mcp.json' && component.agents.includes('claude-code'))
      .flatMap((component) => {
        const value = entryValue(component);
        if (!isRecord(value) || typeof value.url !== 'string' || value.type !== undefined || value.command !== undefined) return [];
        return [{ file: component.file, message: `the server ${quote(component.name, 60)} has a url but no type, so Claude Code reads it as a local server` }];
      });
  },
};

function precedenceIndex(context: DoctorContext, agentId: string): ((file: string) => number) | undefined {
  const agent = knowledge(context).find((candidate) => candidate.id === agentId);
  if (agent === undefined || agent.precedence.status !== 'verified') return undefined;
  const order = agent.precedence.value.filter((entry) => entry.scope === 'project').map((entry) => entry.path);
  return (file) => order.findIndex((path) => globMatch(path, file));
}

export const localOverridesProject: DoctorCheck = {
  id: 'local-overrides-project',
  title: 'No project file silently overrides another',
  level: 'warning',
  description: 'Reports a permission setting written with different values in two project files of the same agent, such as .claude/settings.local.json and .claude/settings.json, and names the file that wins by the agent\'s documented precedence. The other value looks set but has no effect. Lists, which some agents merge across files, are not compared.',
  fix: 'Keep the setting in one file, or make sure the winning value is the one meant; settings.local.json is usually not committed, so it differs between machines.',
  sources: [],
  applies: (context) => project(context).some((component) => component.kind === 'permission'),
  run(context) {
    const permissions = project(context).filter((component) => component.kind === 'permission');
    const hits: DoctorHit[] = [];
    const seen = new Set<string>();
    for (const a of permissions) {
      for (const b of permissions) {
        if (a.file >= b.file || a.name !== b.name || a.raw === b.raw) continue;
        const values = [entryValue(a), entryValue(b)];
        if (values.some((value) => value === undefined || Array.isArray(value))) continue;
        for (const agentId of a.agents.filter((id) => b.agents.includes(id))) {
          const index = precedenceIndex(context, agentId);
          if (index === undefined) continue;
          const [ia, ib] = [index(a.file), index(b.file)];
          if (ia === -1 || ib === -1 || ia === ib) continue;
          const [winner, loser] = ia < ib ? [a, b] : [b, a];
          const key = `${winner.file}\0${loser.file}\0${a.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const agent = knowledge(context).find((candidate) => candidate.id === agentId);
          hits.push({
            file: loser.file,
            message: `${quote(a.name, 60)} is set here, but ${winner.file} sets it to another value and wins for ${agent?.name ?? agentId}`,
            ...(agent !== undefined && agent.precedence.status === 'verified' ? { sources: [agent.precedence.source] } : {}),
          });
        }
      }
    }
    return hits;
  },
};

export const conflictingMcpServer: DoctorCheck = {
  id: 'conflicting-mcp-server',
  title: 'No MCP server is defined twice in different ways',
  level: 'warning',
  description: 'Reports a server name defined in two project files that the same agent reads, with different definitions. Which one wins is not documented for every agent, so the server that runs may not be the one reviewed.',
  fix: 'Keep one definition, or give the servers different names.',
  sources: [],
  applies: (context) => project(context).filter((component) => component.kind === 'mcp-server').length > 1,
  run(context) {
    const servers = project(context).filter((component) => component.kind === 'mcp-server');
    const hits: DoctorHit[] = [];
    const definition = (component: Component) => {
      const value = entryValue(component);
      return value === undefined ? component.raw : canonicalJson(value);
    };
    for (const a of servers) {
      for (const b of servers) {
        if (a.file >= b.file || a.name !== b.name) continue;
        const shared = a.agents.filter((id) => b.agents.includes(id));
        if (shared.length === 0 || definition(a) === definition(b)) continue;
        const sources = unique(knowledge(context).filter((agent) => shared.includes(agent.id)).flatMap((agent) => mcpFacts(agent).map((item) => item.source)));
        hits.push({ file: b.file, message: `the server ${quote(a.name, 60)} is also defined in ${a.file}, differently, and ${shared.join(', ')} ${shared.length === 1 ? 'reads' : 'read'} both`, sources });
      }
    }
    return hits;
  },
};

export const deprecatedFormat: DoctorCheck = {
  id: 'deprecated-format',
  title: 'No deprecated file or setting is used',
  level: 'warning',
  description: 'Reports files and settings that the agent\'s own documentation or code calls legacy or deprecated, as listed in the knowledge base: for example .cursorrules for Cursor and tools.exclude for Gemini CLI. They may stop working in a new version without notice. A deprecation known only from code is reported as info.',
  fix: 'Move the content to the replacement named in the message.',
  sources: [],
  applies: () => true,
  run(context) {
    const components = context.analysis.inventory.components;
    const hits: DoctorHit[] = [];
    const seen = new Set<string>();
    for (const agent of knowledge(context)) {
      for (const fact of agent.deprecations ?? []) {
        for (const item of evidenceOf(fact)) {
          const { paths, key, replacement } = item.value;
          const level = fact.status === 'verified' ? 'warning' : 'info';
          for (const component of components) {
            if (!component.agents.includes(agent.id) || !paths.some((path) => globMatch(path, component.file))) continue;
            let what: string | undefined;
            if (key === undefined) {
              what = component.file;
            } else {
              const parts = key.split('.');
              const field = parts.at(-1) as string;
              const value = entryValue(component);
              if (component.kind === 'permission' && keyMatches(component.name, key)) what = component.name;
              else if (component.kind === 'mcp-server' && parts[1] === '*' && isRecord(value) && Object.hasOwn(value, field)) what = `${field} of the server ${quote(component.name, 60)}`;
            }
            if (what === undefined) continue;
            const message = `${agent.name} calls ${what} deprecated; use ${replacement}`;
            if (seen.has(`${component.file}\0${message}`)) continue;
            seen.add(`${component.file}\0${message}`);
            hits.push({ file: component.file, message, level, sources: [item.source] });
          }
        }
      }
    }
    return hits;
  },
};

export const stalePolicyEntry: DoctorCheck = {
  id: 'stale-policy-entry',
  title: 'Every entry of the policy still matches something',
  level: 'info',
  description: 'Reports exceptions that match no finding, and entries of skills.allowSources and mcp.allowServers that match no skill or server of the project. A stale entry is harmless today, but allows whatever matches it later without a review.',
  fix: 'Remove the entry, or narrow it to what the project uses.',
  sources: [SCHEMA_URL],
  applies: (context) => context.analysis.context.policy !== undefined,
  run(context) {
    const policy = context.analysis.context.policy;
    if (policy === undefined) return [];
    const hits: DoctorHit[] = [];
    const file = 'agentcurfew.policy.json';
    const findings = [...context.analysis.findings, ...context.analysis.suppressed.map((item) => item.finding)];
    (policy.exceptions ?? []).forEach((exception, index) => {
      if (!findings.some((finding) => finding.rule === exception.rule && globMatch(exception.path, finding.file))) hits.push({ file, message: `exceptions[${index}] (${quote(exception.rule, 40)} on ${quote(exception.path, 60)}) matches no finding` });
    });
    const servers = project(context).filter((component) => component.kind === 'mcp-server').map((component) => serverIdentity(component, knowledge(context)));
    (policy.mcp?.allowServers ?? []).forEach((glob, index) => {
      const used = glob === 'local' ? servers.some((server) => server.local) : servers.some((server) => server.names.some((name) => globMatch(glob, name)));
      if (!used) hits.push({ file, message: `mcp.allowServers[${index}] (${quote(glob, 60)}) matches no server of the project` });
    });
    const entries = context.analysis.context.skillsLock?.status === 'ok' ? context.analysis.context.skillsLock.entries : [];
    const skills = project(context).filter((component) => component.kind === 'skill');
    const sources = skills.map((skill) => entries.find((entry) => entry.name === skill.name && entry.source !== '')?.source ?? 'local');
    (policy.skills?.allowSources ?? []).forEach((glob, index) => {
      const used = sources.some((source) => (glob === 'local' ? source === 'local' : source !== 'local' && globMatch(glob, source)));
      if (!used) hits.push({ file, message: `skills.allowSources[${index}] (${quote(glob, 60)}) matches no skill of the project` });
    });
    return hits;
  },
};

/** Every check, in the order of docs/doctor.md. */
export const checks: readonly DoctorCheck[] = [
  invalidPolicy,
  unparsableConfig,
  misnamedFile,
  wrongServersKey,
  missingMcpType,
  localOverridesProject,
  conflictingMcpServer,
  deprecatedFormat,
  stalePolicyEntry,
];
