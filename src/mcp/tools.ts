import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { analyzeProjectAsync } from '../analyze.ts';
import { checkMcpPackages } from '../depcurfew/bridge.ts';
import { scanSkillFolder } from '../inventory/index.ts';
import type { Component, Inventory } from '../inventory/types.ts';
import { knowledgeBase } from '../knowledge/index.ts';
import { projectContext } from '../lock/context.ts';
import { applyPolicy, today } from '../policy/apply.ts';
import type { Suppressed } from '../policy/apply.ts';
import { findRule, rules, runRules } from '../rules/index.ts';
import { quote } from '../rules/mask.ts';
import { explainText } from '../rules/render.ts';
import type { Finding, RuleContext } from '../rules/types.ts';
import { closest } from '../text/distance.ts';

/** The first schema issue of the policy; its path holds key names from the file, so it is quoted and cut short. */
function policySchemaError(issues: readonly { path: string; message: string }[]): string {
  const first = issues[0];
  return `agentcurfew.policy.json does not follow the schema: ${quote(first?.path ?? 'policy', 120)}: ${first?.message ?? 'invalid'}`;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolContext {
  /** The folder the server was started in; paths are resolved against it. */
  root: string;
  /** Folders the tools may read: the root, folders given with --root, and the client's roots (2025-11-25). */
  allowed: () => readonly string[];
  now?: Date;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const TOOLS = [
  {
    name: 'scan_project',
    title: 'Scan a project',
    description:
      'Checks what steers AI coding agents in a project (skills, MCP servers, hooks, context files, permissions) against the agentcurfew rules and the project policy. Reads files only; nothing is run. Returns findings with level, rule, file and a message; secrets are masked.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'The project folder; the server folder when omitted.' } }, additionalProperties: false },
    annotations: { title: 'Scan a project', ...READ_ONLY },
  },
  {
    name: 'check_skill',
    title: 'Check a skill before installing it',
    description:
      'Checks one skill folder (with SKILL.md) before it is installed: hidden characters, dangerous or obfuscated scripts, instructions fetched at run time, persistence instructions, broad tool grants, and the project policy. Use it on a downloaded or cloned skill before adding it.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'The skill folder, which holds SKILL.md.' } }, required: ['path'], additionalProperties: false },
    annotations: { title: 'Check a skill', ...READ_ONLY },
  },
  {
    name: 'check_mcp_config',
    title: 'Check an MCP server definition',
    description:
      'Checks an MCP server definition before it is added: an unpinned package, a plain-HTTP address, secrets written into it, hidden characters, and the allowed servers of the project policy. Pass one server ({"command": ..., "args": [...]} or {"url": ...}), or a map of servers as in .mcp.json.',
    inputSchema: {
      type: 'object',
      properties: {
        config: { type: 'object', description: 'One server, or {"mcpServers": {...}}, {"servers": {...}} or a map of name to server.' },
        name: { type: 'string', description: 'The name of the server when config is a single server.' },
      },
      required: ['config'],
      additionalProperties: false,
    },
    annotations: { title: 'Check an MCP server definition', ...READ_ONLY },
  },
  {
    name: 'explain_rule',
    title: 'Explain a rule',
    description: 'What an agentcurfew rule finds, why it matters, its OWASP Agentic Skills Top 10 references and how to fix it.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The rule id, such as hidden-unicode.' } }, required: ['id'], additionalProperties: false },
    annotations: { title: 'Explain a rule', ...READ_ONLY },
  },
] as const;

function error(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A folder the tools may read, after links are resolved, or why not. */
function allowedPath(context: ToolContext, given: unknown): { path: string } | { why: string } {
  if (given !== undefined && typeof given !== 'string') return { why: 'path must be a string' };
  const wanted = resolve(context.root, given ?? '.');
  const isInside = (path: string): boolean =>
    context.allowed().some((folder) => {
      const rel = relative(folder, path);
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(`..${sep}`));
    });
  const outside = { why: 'the path is outside the folders this server may read (its own folder, --root folders and the client roots)' };
  let real: string;
  try {
    real = realpathSync.native(wanted);
  } catch {
    // A missing path gets the same answer as an existing one outside, so the answer tells nothing about other folders.
    let parent = dirname(wanted);
    for (;;) {
      try {
        return isInside(realpathSync.native(parent)) ? { why: 'the path does not exist' } : outside;
      } catch {
        if (dirname(parent) === parent) return outside;
        parent = dirname(parent);
      }
    }
  }
  return isInside(real) ? { path: real } : outside;
}

function findingLine(finding: Finding): string {
  const place = finding.line === undefined ? '' : `:${finding.line}${finding.column === undefined ? '' : `:${finding.column}`}`;
  return `${finding.level.toUpperCase()} ${finding.rule} ${quote(finding.file, 120)}${place} (${quote(finding.name, 60)}): ${finding.message}`;
}

function report(title: string, findings: readonly Finding[], suppressed: readonly Suppressed[], extra: Record<string, unknown>): ToolResult {
  const lines = [`${title}: ${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}`, ...findings.map(findingLine)];
  if (suppressed.length > 0) lines.push(`${suppressed.length} accepted by exceptions of agentcurfew.policy.json`);
  const structured = { findings, suppressed, ...extra };
  return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: structured };
}

/** The project context for checks of something not installed yet: the policy, but no locks, which would only say "new". */
function checkContext(root: string): { context: RuleContext; policyError?: string } {
  const { context, policy } = projectContext(root);
  const result: RuleContext = { knowledge: knowledgeBase };
  if (context.policy !== undefined) result.policy = context.policy;
  return policy.status === 'invalid' ? { context: result, policyError: policySchemaError(policy.issues) } : { context: result };
}

async function checkInventory(inventory: Inventory, context: ToolContext, kinds: readonly string[]): Promise<{ findings: Finding[]; suppressed: Suppressed[]; policyError?: string }> {
  const { context: ruleContext, policyError } = checkContext(context.root);
  if (kinds.includes('mcp-server')) ruleContext.packageReports = (await checkMcpPackages(inventory, context.root, context.now)).reports;
  const selected = rules.filter((rule) => rule.id !== 'drift' && rule.id !== 'skills-lock-mismatch' && (rule.kinds.some((kind) => kinds.includes(kind)) || rule.id === 'out-of-policy' || rule.id === 'mcp-package'));
  const result = applyPolicy(runRules(inventory, { rules: selected, context: ruleContext }), ruleContext.policy, today(context.now));
  return policyError === undefined ? result : { ...result, policyError };
}

function servers(config: Record<string, unknown>, name: unknown): [string, unknown][] | undefined {
  if (typeof config.command === 'string' || typeof config.url === 'string' || typeof config.httpUrl === 'string' || typeof config.serverUrl === 'string') return [[typeof name === 'string' && name !== '' ? name : 'server', config]];
  for (const key of ['mcpServers', 'servers', 'mcp_servers']) if (isRecord(config[key])) return Object.entries(config[key] as Record<string, unknown>);
  const entries = Object.entries(config);
  return entries.length > 0 && entries.every(([, value]) => isRecord(value)) ? entries : undefined;
}

export async function callTool(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  // Every input schema says additionalProperties: false; an argument it does not list is an error, as documented.
  const tool = TOOLS.find((item) => item.name === name);
  const allowed = new Set(Object.keys(tool?.inputSchema.properties ?? {}));
  const extra = Object.keys(args).filter((key) => !allowed.has(key));
  if (tool !== undefined && extra.length > 0) return error(`unknown argument ${quote(extra[0] ?? '', 40)}; ${name} takes ${[...allowed].join(', ') || 'none'}`);
  if (name === 'explain_rule') {
    if (typeof args.id !== 'string') return error('id must be a string');
    const rule = findRule(args.id);
    if (rule === undefined) {
      const near = closest(args.id, rules.map((item) => item.id));
      return error(`unknown rule ${quote(args.id, 60)}${near === undefined ? '.' : `; did you mean ${near}?`} The rules are ${rules.map((item) => item.id).join(', ')}.`);
    }
    return { content: [{ type: 'text', text: explainText(rule) }], structuredContent: { id: rule.id, title: rule.title, level: rule.level, owasp: [...rule.owasp], description: rule.description, fix: rule.fix } };
  }
  if (name === 'scan_project') {
    const where = allowedPath(context, args.path);
    if ('why' in where) return error(where.why);
    const analysis = await analyzeProjectAsync(where.path, context.now === undefined ? {} : { now: context.now });
    if (analysis.policy.status === 'invalid') return error(policySchemaError(analysis.policy.issues));
    return report('Project', analysis.findings, analysis.suppressed, { components: analysis.inventory.components.length, problems: analysis.inventory.problems });
  }
  if (name === 'check_skill') {
    const where = allowedPath(context, args.path);
    if ('why' in where) return error(where.why);
    const inventory = scanSkillFolder(where.path);
    if (inventory.components.length === 0) return error('the folder has no SKILL.md, or it could not be read');
    const { findings, suppressed, policyError } = await checkInventory(inventory, context, ['skill']);
    if (policyError !== undefined) return error(policyError);
    return report('Skill', findings, suppressed, { problems: inventory.problems });
  }
  if (name === 'check_mcp_config') {
    if (!isRecord(args.config)) return error('config must be an object');
    const entries = servers(args.config, args.name);
    if (entries === undefined) return error('config is neither a server nor a map of servers');
    const agents = knowledgeBase.filter((agent) => agent.mcp.status === 'disputed' || agent.mcp.value !== null).map((agent) => agent.id).sort();
    const components: Component[] = entries.map(([server, value]) => ({ kind: 'mcp-server', agents, scope: 'project', file: '<config>', name: server, raw: JSON.stringify(value) ?? '' }));
    const { findings, suppressed, policyError } = await checkInventory({ components, problems: [] }, context, ['mcp-server']);
    if (policyError !== undefined) return error(policyError);
    return report('MCP configuration', findings, suppressed, { servers: entries.length });
  }
  return error(`unknown tool ${quote(name, 60)}`);
}
