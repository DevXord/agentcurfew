import { scanInventory } from './inventory/index.ts';
import type { Inventory } from './inventory/types.ts';
import { projectContext } from './lock/context.ts';
import type { LockRead } from './lock/read.ts';
import { applyPolicy, excludePaths, today } from './policy/apply.ts';
import type { Suppressed } from './policy/apply.ts';
import type { PolicyRead } from './policy/read.ts';
import { runRules } from './rules/index.ts';
import type { Finding, RuleContext } from './rules/types.ts';

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
export function analyzeProject(root: string, options: { user?: boolean; now?: Date; rules?: boolean } = {}): Analysis {
  const { context, lock, policy } = projectContext(root);
  const inventory = excludePaths(scanInventory({ root, user: options.user === true }), context.policy);
  if (options.rules === false) return { inventory, context, lock, policy, findings: [], suppressed: [] };
  const { findings, suppressed } = applyPolicy(runRules(inventory, { context }), context.policy, today(options.now));
  return { inventory, context, lock, policy, findings, suppressed };
}
