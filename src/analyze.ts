import { scanInventory } from './inventory/index.ts';
import type { Inventory } from './inventory/types.ts';
import { projectContext } from './lock/context.ts';
import type { LockRead } from './lock/read.ts';
import { applyPolicy, excludePaths, today } from './policy/apply.ts';
import type { Suppressed } from './policy/apply.ts';
import type { PolicyRead } from './policy/read.ts';
import { runRules } from './rules/index.ts';
import type { Finding, RuleContext } from './rules/types.ts';
import { checkMcpPackages } from './depcurfew/bridge.ts';
import type { DepcurfewState, PackageReport } from './depcurfew/bridge.ts';

export interface Analysis {
  inventory: Inventory;
  context: RuleContext;
  lock: LockRead;
  policy: PolicyRead;
  findings: Finding[];
  suppressed: Suppressed[];
}

/**
 * The whole check of a project: inventory without the policy's excluded paths, the rules with the project's locks and
 * policy, then the policy's levels and exceptions. With an invalid policy nothing of it is applied; callers stop there.
 */
export interface AnalyzeOptions {
  user?: boolean;
  now?: Date;
  rules?: boolean;
  overlay?: ReadonlyMap<string, string>;
  packageReports?: ReadonlyMap<string, PackageReport>;
}

export function analyzeProject(root: string, options: AnalyzeOptions = {}): Analysis {
  const { context, lock, policy } = projectContext(root);
  if (options.packageReports !== undefined) context.packageReports = options.packageReports;
  const scanned = scanInventory({ root, user: options.user === true, ...(options.overlay === undefined ? {} : { overlay: options.overlay }) });
  const inventory = excludePaths(scanned, context.policy);
  if (options.rules === false) return { inventory, context, lock, policy, findings: [], suppressed: [] };
  const { findings, suppressed } = applyPolicy(runRules(inventory, { context }), context.policy, today(options.now));
  return { inventory, context, lock, policy, findings, suppressed };
}

/**
 * analyzeProject with depcurfew's offline check of the packages MCP servers start, when depcurfew is installed. depcurfew
 * is asynchronous, so its reports are gathered first and the rules read them from their context.
 */
export async function analyzeProjectAsync(root: string, options: AnalyzeOptions = {}): Promise<Analysis & { depcurfew: DepcurfewState }> {
  const first = analyzeProject(root, { ...options, rules: false });
  if (first.policy.status === 'invalid' || options.rules === false) return { ...first, depcurfew: { status: 'missing', reason: 'not checked' } };
  const { state, reports } = await checkMcpPackages(first.inventory, root, options.now);
  return { ...analyzeProject(root, { ...options, packageReports: reports }), depcurfew: state };
}
