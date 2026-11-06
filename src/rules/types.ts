import type { Component, ComponentKind } from '../inventory/types.ts';
import type { AgentKnowledge } from '../knowledge/types.ts';

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
}

export interface RuleContext {
  knowledge: readonly AgentKnowledge[];
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
  /** A short example of what it finds, for explain and docs/rules.md. */
  example: string;
  kinds: readonly ComponentKind[];
  check(component: Component, context: RuleContext): readonly RuleHit[];
}

export interface Finding {
  rule: string;
  level: Level;
  kind: ComponentKind;
  file: string;
  name: string;
  line?: number;
  column?: number;
  message: string;
}
