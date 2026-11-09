import { knowledgeBase, shared } from './index.ts';
import type { AgentKnowledge, Evidence, Fact } from './types.ts';
import { AGENT_FIELDS } from './validate.ts';

type Field = (typeof AGENT_FIELDS)[number];

const LABELS: Readonly<Record<Field, string>> = {
  precedence: 'Configuration, winner first',
  mcp: 'MCP servers',
  hooks: 'Hooks',
  skills: 'Skills',
  contextFiles: 'Context files',
  permissions: 'Permissions',
  autoRun: 'Automatic start',
  extensions: 'Subagents and commands',
};

function collectPaths(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) value.forEach((item) => collectPaths(item, found));
  else if (typeof value === 'object' && value !== null) {
    if ('path' in value && typeof value.path === 'string') found.add(value.path);
    else Object.values(value).forEach((item) => collectPaths(item, found));
  }
}

function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function code(text: string): string {
  return `\`${text}\``;
}

function details(field: Field, value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  if (field === 'mcp') return [`key ${code(String(record.serversKey))}`];
  if (field === 'hooks') return [`${(record.events as unknown[]).length} events`, `handlers: ${(record.handlerTypes as string[]).map(code).join(', ')}`];
  if (field === 'skills') return [`entry ${code(String(record.entryFile))}`];
  if (field === 'autoRun') return [`${code(String(record.triggerKey))} = ${code(String(record.triggerValue))}`];
  return [];
}

function summary(field: Field, value: unknown): string {
  if (value === null) return 'none';
  const found = new Set<string>();
  collectPaths(value, found);
  return cell([...[...found].map(code), ...details(field, value)].join('<br>'));
}

function link(source: string): string {
  return `[source](${source})`;
}

function evidenceOf<T>(fact: Fact<T>): readonly Evidence<T>[] {
  return fact.status === 'disputed' ? fact.variants : [fact];
}

function agentSection(agent: AgentKnowledge): string[] {
  const rows = AGENT_FIELDS.map((field) => {
    const fact = agent[field] as Fact<unknown>;
    const value = evidenceOf(fact)
      .map((evidence) => summary(field, evidence.value))
      .join('<br>**or**<br>');
    const sources = evidenceOf(fact)
      .map((evidence) => link(evidence.source))
      .join(', ');
    const dates = [...new Set(evidenceOf(fact).map((evidence) => evidence.verifiedAt))].join(', ');
    return `| ${LABELS[field]} | ${fact.status} | ${value} | ${sources} | ${dates} |`;
  });
  return [`## ${agent.name}`, '', '| Fact | Status | Value | Source | Verified |', '| --- | --- | --- | --- | --- |', ...rows, ''];
}

function deprecationLines(): string[] {
  const lines: string[] = [];
  for (const agent of knowledgeBase) {
    for (const fact of agent.deprecations ?? []) {
      for (const evidence of evidenceOf(fact)) {
        const what = evidence.value.key === undefined ? evidence.value.paths.map(code).join(', ') : `${code(evidence.value.key)} in ${evidence.value.paths.map(code).join(', ')}`;
        lines.push(`| ${agent.name} | ${what} | ${cell(evidence.value.replacement)} | ${fact.status} | ${link(evidence.source)} | ${evidence.verifiedAt} |`);
      }
    }
  }
  return lines;
}

function commandLines(): string[] {
  const lines: string[] = [];
  for (const agent of knowledgeBase) {
    if (agent.toolHook !== undefined) {
      for (const evidence of evidenceOf(agent.toolHook)) {
        const value = evidence.value;
        lines.push(`| ${agent.name} | hook ${code(value.event)} | tools ${Object.keys(value.tools).map(code).join(', ')}; answer ${code(value.decisionField)} (${value.decisions.map(code).join(' > ')}) | ${agent.toolHook.status} | ${link(evidence.source)} | ${evidence.verifiedAt} |`);
      }
    }
    if (agent.commands !== undefined) {
      for (const evidence of evidenceOf(agent.commands)) {
        const settings = evidence.value.settings.map((setting) => {
          const where = setting.fromProject === 'ignored' ? ', ignored in a project file' : setting.fromProject === 'needs-trust' ? ', once the folder is trusted' : '';
          return `${code(setting.commandField === undefined ? setting.key : `${setting.key}.${setting.commandField}`)} (${setting.runs === 'session-start' ? 'at session start' : 'when needed'}${where})`;
        });
        lines.push(`| ${agent.name} | settings that run a command | ${settings.join('<br>')} | ${agent.commands.status} | ${link(evidence.source)} | ${evidence.verifiedAt} |`);
      }
    }
    if (agent.mcpAdd !== undefined) {
      for (const evidence of evidenceOf(agent.mcpAdd)) {
        lines.push(`| ${agent.name} | add an MCP server | ${code(evidence.value.command.join(' '))}, ${code(evidence.value.jsonCommand.join(' '))} | ${agent.mcpAdd.status} | ${link(evidence.source)} | ${evidence.verifiedAt} |`);
      }
    }
  }
  for (const evidence of evidenceOf(shared.skillsInstaller)) {
    lines.push(`| skills installer | add a skill | ${code(`npx ${evidence.value.packageName} ${evidence.value.addCommand} <source>`)} | ${shared.skillsInstaller.status} | ${link(evidence.source)} | ${evidence.verifiedAt} |`);
  }
  return lines;
}

function openFacts(): string[] {
  const lines: string[] = [];
  for (const agent of knowledgeBase) {
    for (const field of AGENT_FIELDS) {
      const fact = agent[field] as Fact<unknown>;
      if (fact.status === 'verified') continue;
      const sources = evidenceOf(fact)
        .map((evidence) => link(evidence.source))
        .join(', ');
      lines.push(`- **${agent.name}, ${LABELS[field]}** (${fact.status}): ${cell(fact.note)} ${sources}`);
    }
  }
  return lines;
}

/** The text of docs/knowledge.md. */
export function renderKnowledge(): string {
  const lines = [
    '# Knowledge base',
    '',
    'Generated from `src/knowledge/` by `npm run docs:knowledge`; do not edit by hand. Notes on verified facts are in the modules.',
    '',
    '**Status:** `verified` was read in an official source, `uncertain` is supported but not conclusive, `disputed` means official sources disagree and every variant is shown. "none" means the agent is known not to have the feature, unless the status says otherwise.',
    '',
    '## Disputed and uncertain facts',
    '',
    ...openFacts(),
    '',
    ...knowledgeBase.flatMap(agentSection),
    '## Deprecated files and settings',
    '',
    '| Agent | What | Replaced by | Status | Source | Verified |',
    '| --- | --- | --- | --- | --- | --- |',
    ...deprecationLines(),
    '',
    '## Hooks and commands',
    '',
    '| Agent | What | Value | Status | Source | Verified |',
    '| --- | --- | --- | --- | --- | --- |',
    ...commandLines(),
    '',
    '## Shared formats',
    '',
    '| Fact | Status | Value | Source | Verified |',
    '| --- | --- | --- | --- | --- |',
    `| Agent Skills format | ${shared.skillFormat.status} | ${evidenceOf(shared.skillFormat).map((e) => code(e.value.entryFile)).join(', ')} | ${evidenceOf(shared.skillFormat).map((e) => link(e.source)).join(', ')} | ${evidenceOf(shared.skillFormat).map((e) => e.verifiedAt).join(', ')} |`,
    `| skills-lock.json | ${shared.skillsLock.status} | ${evidenceOf(shared.skillsLock).map((e) => cell(e.value.hashAlgorithm)).join(' ')} | ${evidenceOf(shared.skillsLock).map((e) => link(e.source)).join(', ')} | ${evidenceOf(shared.skillsLock).map((e) => e.verifiedAt).join(', ')} |`,
    '',
  ];
  return lines.join('\n');
}
