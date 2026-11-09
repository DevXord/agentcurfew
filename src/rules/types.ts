import type { Component, ComponentKind, Inventory } from '../inventory/types.ts';
import type { AgentKnowledge } from '../knowledge/types.ts';
import type { SkillsLockRead } from '../lock/skills-lock.ts';
import type { Lockfile } from '../lock/types.ts';
import type { PackageReport } from '../depcurfew/bridge.ts';
import type { Policy } from '../policy/types.ts';

export const LEVELS = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Level = (typeof LEVELS)[number];

/** OWASP Agentic Skills Top 10, version 1.0 (2026): https://github.com/OWASP/www-project-agentic-skills-top-10 */
export const OWASP_AST = {
  AST01: 'Malicious Skills',
  AST02: 'Supply Chain Compromise',
  AST03: 'Over-Privileged Skills',
  AST04: 'Insecure Metadata',
  AST05: 'Untrusted External Instructions',
  AST06: 'Weak Isolation',
  AST07: 'Update Drift',
  AST08: 'Poor Scanning',
  AST09: 'No Governance',
  AST10: 'Cross-Platform Reuse',
} as const;
export type OwaspId = keyof typeof OWASP_AST;

/** What a rule saw in one component. The message must already be safe to print: no secrets, no hidden characters. */
export interface RuleHit {
  message: string;
  /** Overrides the rule's level for this hit. */
  level?: Level;
  /** 1-based, within the component's file; only when the component's text is the file. */
  line?: number;
  column?: number;
  /** A file of a skill folder, relative to it, when the hit is there and not in SKILL.md. */
  inFile?: string;
  /** Which kind of hit of the rule it is, for policy settings that move only some of them (network). */
  tag?: string;
}

export interface RuleContext {
  knowledge: readonly AgentKnowledge[];
  /** agentcurfew.lock of the project, when there is a valid one. */
  lock?: Lockfile;
  /** skills-lock.json of the project, when there is one. */
  skillsLock?: SkillsLockRead;
  /** Whether execute bits can be compared here (not on Windows). */
  compareExecutableBits?: boolean;
  /** agentcurfew.policy.json, when there is a valid one. */
  policy?: Policy;
  /** depcurfew's offline reports on the packages MCP servers start, keyed by file and server name (D-028). */
  packageReports?: ReadonlyMap<string, PackageReport>;
}

/** A hit of a rule that looks at the whole project, such as drift, which also reports what is no longer there. */
export interface ProjectHit extends RuleHit {
  kind: ComponentKind;
  file: string;
  name: string;
  componentId?: string;
}

export interface Rule {
  /** Kebab case, stable: policies and suppressions refer to it. */
  id: string;
  title: string;
  /** The usual level; a hit may raise or lower it. */
  level: Level;
  owasp: readonly OwaspId[];
  description: string;
  fix: string;
  /** Pattern matching that can be wrong: says how it may raise a false alarm. */
  falsePositives?: string;
  /** When a finding gets another level than `level`, in words; shown by explain and in docs/rules.md. */
  levels?: string;
  /** A short example of what it finds, for explain and docs/rules.md. */
  example: string;
  kinds: readonly ComponentKind[];
  check(component: Component, context: RuleContext): readonly RuleHit[];
  /** Runs once per scan, after the components. */
  checkProject?(inventory: Inventory, context: RuleContext): readonly ProjectHit[];
}

export interface Finding {
  rule: string;
  level: Level;
  kind: ComponentKind;
  file: string;
  name: string;
  /** The component's stable id (D-042); absent for a finding about the whole project with no component. */
  componentId?: string;
  line?: number;
  column?: number;
  message: string;
  tag?: string;
  /** The policy setting that set the level, when one did. */
  policy?: string;
}
