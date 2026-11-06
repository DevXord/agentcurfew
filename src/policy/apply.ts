import type { Inventory } from '../inventory/types.ts';
import type { Finding, Level } from '../rules/types.ts';
import { globMatch } from './glob.ts';
import type { Policy } from './types.ts';

/** The inventory without the components and problems of excluded paths. */
export function excludePaths(inventory: Inventory, policy: Policy | undefined): Inventory {
  const exclude = policy?.exclude ?? [];
  if (exclude.length === 0) return inventory;
  const kept = (file: string) => !exclude.some((entry) => globMatch(entry.path, file));
  return { components: inventory.components.filter((component) => kept(component.file)), problems: inventory.problems.filter((problem) => kept(problem.file)) };
}

interface Toggle {
  field: string;
  value: (policy: Policy) => boolean | undefined;
  /** The rule, and optionally the tag of its hits, that the setting moves. */
  rule: string;
  tag?: string;
  /** The level when the setting is true and when it is false; undefined leaves it as the rule sets it. */
  whenTrue: Level | undefined;
  whenFalse: Level | undefined;
}

const TOGGLES: readonly Toggle[] = [
  { field: 'mcp.requirePinnedVersions', value: (policy) => policy.mcp?.requirePinnedVersions, rule: 'unpinned-mcp-server', whenTrue: 'high', whenFalse: 'info' },
  { field: 'mcp.denyPlainHttp', value: (policy) => policy.mcp?.denyPlainHttp, rule: 'plain-http-mcp', whenTrue: undefined, whenFalse: 'info' },
  { field: 'hooks.allowNetwork', value: (policy) => policy.hooks?.allowNetwork, rule: 'dangerous-hook-command', tag: 'network', whenTrue: 'info', whenFalse: 'high' },
  { field: 'hooks.allowAutoRunOnOpen', value: (policy) => policy.hooks?.allowAutoRunOnOpen, rule: 'auto-run-on-open', whenTrue: 'info', whenFalse: 'high' },
  { field: 'contextFiles.denyHiddenUnicode', value: (policy) => policy.contextFiles?.denyHiddenUnicode, rule: 'hidden-unicode', whenTrue: undefined, whenFalse: 'info' },
];

export interface Suppressed {
  finding: Finding;
  reason: string;
  until?: string;
}

export interface PolicyResult {
  findings: Finding[];
  suppressed: Suppressed[];
}

/**
 * Findings after the policy: settings move the level of the rules they name (the finding then says which setting), and
 * exceptions move matching findings to `suppressed`, until the day after their date. `today` is YYYY-MM-DD.
 */
export function applyPolicy(findings: readonly Finding[], policy: Policy | undefined, today: string): PolicyResult {
  if (policy === undefined) return { findings: [...findings], suppressed: [] };
  const result: PolicyResult = { findings: [], suppressed: [] };
  for (const original of findings) {
    let finding = original;
    for (const toggle of TOGGLES) {
      const value = toggle.value(policy);
      if (value === undefined || finding.rule !== toggle.rule || (toggle.tag !== undefined && finding.tag !== toggle.tag)) continue;
      const level = value ? toggle.whenTrue : toggle.whenFalse;
      if (level !== undefined && level !== finding.level) finding = { ...finding, level, policy: toggle.field };
    }
    const exception = (policy.exceptions ?? []).find((entry) => entry.rule === finding.rule && globMatch(entry.path, finding.file));
    if (exception === undefined) {
      result.findings.push(finding);
    } else if (exception.until !== undefined && exception.until < today) {
      result.findings.push({ ...finding, message: `${finding.message}; the exception for it expired on ${exception.until}` });
    } else {
      result.suppressed.push({ finding, reason: exception.reason, ...(exception.until === undefined ? {} : { until: exception.until }) });
    }
  }
  return result;
}

/** Today in UTC as YYYY-MM-DD. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
