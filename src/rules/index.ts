import { autoRunOnOpen } from './rules/auto-run-on-open.ts';
import { broadShellPermission } from './rules/broad-shell-permission.ts';
import { dangerousHookCommand } from './rules/dangerous-hook-command.ts';
import { drift } from './rules/drift.ts';
import { envOverride } from './rules/env-override.ts';
import { hiddenUnicode } from './rules/hidden-unicode.ts';
import { mcpPackage } from './rules/mcp-package.ts';
import { obfuscatedContent } from './rules/obfuscated-content.ts';
import { outOfPolicy } from './rules/out-of-policy.ts';
import { permissionBypass } from './rules/permission-bypass.ts';
import { pluginMarketplace } from './rules/plugin-marketplace.ts';
import { persistenceInstruction } from './rules/persistence-instruction.ts';
import { plainHttpMcp } from './rules/plain-http-mcp.ts';
import { remoteInstructions } from './rules/remote-instructions.ts';
import { secretInConfig } from './rules/secret-in-config.ts';
import { skillsLockMismatch } from './rules/skills-lock-mismatch.ts';
import { unpinnedLauncher } from './rules/unpinned-launcher.ts';
import { unpinnedMcpServer } from './rules/unpinned-mcp-server.ts';
import type { Inventory } from '../inventory/types.ts';
import { applyRules } from './engine.ts';
import type { Finding, Rule, RuleContext } from './types.ts';

/** Every rule, in the order of docs/rules.md. */
export const rules: readonly Rule[] = [
  hiddenUnicode,
  unpinnedMcpServer,
  plainHttpMcp,
  secretInConfig,
  dangerousHookCommand,
  unpinnedLauncher,
  autoRunOnOpen,
  permissionBypass,
  broadShellPermission,
  envOverride,
  pluginMarketplace,
  remoteInstructions,
  obfuscatedContent,
  persistenceInstruction,
  drift,
  skillsLockMismatch,
  outOfPolicy,
  mcpPackage,
];

/** Rules of the plan that need a later phase; none left since phase 5. */
export const plannedRules: readonly { id: string; title: string; owasp: readonly string[]; phase: number }[] = [];

export function findRule(id: string): Rule | undefined {
  return rules.find((rule) => rule.id === id);
}

/** Runs every rule, or the ones given, on an inventory. Pure and deterministic; see applyRules. */
export function runRules(inventory: Inventory, options: { rules?: readonly Rule[]; context?: RuleContext } = {}): Finding[] {
  return applyRules(inventory, options.rules ?? rules, options.context);
}

export { applyRules, atLeast, LEVEL_RANK } from './engine.ts';
export { LEVELS, OWASP_AST } from './types.ts';
export type { Finding, Level, OwaspId, ProjectHit, Rule, RuleContext, RuleHit } from './types.ts';
