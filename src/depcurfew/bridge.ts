import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Inventory } from '../inventory/types.ts';
import { knowledgeBase } from '../knowledge/index.ts';
import { launch } from '../rules/launch.ts';
import { commandLine, mcpEntry } from '../rules/mcp.ts';

type Depcurfew = typeof import('depcurfew');

/** The versions of depcurfew whose public API this bridge was written against (D-028). */
export const SUPPORTED_RANGE = '>=1.5.2 <2';

/**
 * depcurfew's findings that need no network: the policy's forbidden sources and specs that are not specs. Every other
 * code (unverified, not-found, too-young, install scripts, similar names, known malicious versions) needs the registry
 * or data agentcurfew does not read, so it is never reported here (D-028).
 */
export const OFFLINE_CODES: ReadonlySet<string> = new Set(['forbidden-source', 'invalid-spec', 'unchecked-source', 'insecure-registry']);

export interface PackageFinding {
  level: 'error' | 'warning';
  code: string;
  message: string;
  fix: string;
}

export interface PackageReport {
  spec: string;
  findings: PackageFinding[];
}

export type DepcurfewState = { status: 'missing' | 'unsupported' | 'no-policy' | 'invalid-policy'; reason: string } | { status: 'ready'; version: string };

let loader: () => Promise<Depcurfew | undefined> = async () => {
  try {
    return (await import('depcurfew')) as Depcurfew;
  } catch {
    return undefined;
  }
};

/** For tests: how depcurfew is loaded, so that a run without it can be simulated. */
export function setDepcurfewLoader(load: () => Promise<Depcurfew | undefined>): void {
  loader = load;
  cached = undefined;
}

let cached: Promise<Depcurfew | undefined> | undefined;

function supported(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) return false;
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return major === 1 && (minor > 5 || (minor === 5 && patch >= 2));
}

/** A fetch that refuses every request: agentcurfew never uses the network, so depcurfew gets no answer from a registry. */
const offline = async (): Promise<Response> => {
  throw new Error('agentcurfew does not use the network');
};

/** The spec depcurfew reads for the package a launcher fetches, or undefined for images and unknown launchers. */
export function depcurfewSpec(family: string, spec: string): string | undefined {
  if (family === 'npm') return spec;
  if (family === 'uv' || family === 'pipx') {
    const at = /^([A-Za-z0-9][\w.-]*(?:\[[^\]]*\])?)@(\d[\w.!+-]*)$/.exec(spec);
    return `pypi:${at === null ? spec : `${at[1]}==${at[2]}`}`;
  }
  return undefined;
}

/**
 * Checks the packages that MCP servers of the project start through npx, uvx and the like with depcurfew's public API,
 * offline, against the project's depcurfew.json. Reports are keyed by file and server name. Without depcurfew, with
 * another major version, or without depcurfew.json, nothing is checked and the state says why.
 */
/** How many project MCP servers start a package that mcp-package would give depcurfew to check. */
export function checkableServers(inventory: Inventory): number {
  let count = 0;
  for (const component of inventory.components) {
    if (component.kind !== 'mcp-server' || component.scope !== 'project') continue;
    const entry = mcpEntry(component, knowledgeBase);
    const started = entry === undefined ? undefined : launch(commandLine(entry));
    if (started?.spec !== undefined && depcurfewSpec(started.family, started.spec) !== undefined) count++;
  }
  return count;
}

export async function checkMcpPackages(inventory: Inventory, root: string, now: Date = new Date()): Promise<{ state: DepcurfewState; reports: Map<string, PackageReport> }> {
  const reports = new Map<string, PackageReport>();
  cached ??= loader();
  const depcurfew = await cached;
  if (depcurfew === undefined) return { state: { status: 'missing', reason: 'depcurfew is not installed' }, reports };
  const version = depcurfew.getVersion();
  if (!supported(version)) return { state: { status: 'unsupported', reason: `depcurfew ${version} is outside ${SUPPORTED_RANGE}` }, reports };
  if (!existsSync(join(root, 'depcurfew.json'))) return { state: { status: 'no-policy', reason: 'the project has no depcurfew.json' }, reports };
  let policy: ReturnType<Depcurfew['loadPolicy']>;
  try {
    policy = depcurfew.loadPolicy(root);
  } catch {
    return { state: { status: 'invalid-policy', reason: 'depcurfew.json cannot be read by depcurfew' }, reports };
  }
  const wanted: { key: string; spec: string }[] = [];
  for (const component of inventory.components) {
    if (component.kind !== 'mcp-server' || component.scope !== 'project') continue;
    const entry = mcpEntry(component, knowledgeBase);
    const started = entry === undefined ? undefined : launch(commandLine(entry));
    const spec = started?.spec === undefined ? undefined : depcurfewSpec(started.family, started.spec);
    if (spec !== undefined) wanted.push({ key: `${component.file}\0${component.name}`, spec });
  }
  if (wanted.length === 0) return { state: { status: 'ready', version }, reports };
  const results = await depcurfew.checkSpecs(
    wanted.map((item) => item.spec),
    { policy, fetch: offline, now, registry: 'https://registry.npmjs.org/', popular: new depcurfew.PopularNames([]) },
  );
  results.forEach((report, index) => {
    const item = wanted[index];
    if (item === undefined) return;
    const findings = report.findings.filter((finding) => OFFLINE_CODES.has(finding.code)).map(({ level, code, message, fix }) => ({ level, code, message, fix }));
    reports.set(item.key, { spec: item.spec, findings });
  });
  return { state: { status: 'ready', version }, reports };
}
