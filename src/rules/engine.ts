import type { Inventory } from '../inventory/types.ts';
import { knowledgeBase } from '../knowledge/index.ts';
import { quote } from './mask.ts';
import type { Finding, Level, ProjectHit, Rule, RuleContext } from './types.ts';
import { LEVELS } from './types.ts';

export const LEVEL_RANK: Readonly<Record<Level, number>> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** Whether a level is as severe as a threshold or more. */
export function atLeast(level: Level, threshold: Level): boolean {
  return LEVEL_RANK[level] <= LEVEL_RANK[threshold];
}

/** Hits of one rule on one component past this many are summed up in one more finding. */
const MAX_HITS = 20;

function compare(a: string | number, b: string | number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Runs the rules on an inventory. Pure: it reads only the inventory and the knowledge base, so the same inventory always
 * gives the same findings in the same order. A rule that throws is reported as a finding and does not stop the others.
 */
export function applyRules(inventory: Inventory, selected: readonly Rule[], context: RuleContext = { knowledge: knowledgeBase }): Finding[] {
  const findings: Finding[] = [];
  // A hook that starts on its own is both a hook and an auto-run component; a rule on both reports it once.
  const reported = new Set<string>();
  for (const component of inventory.components) {
    for (const rule of selected) {
      if (!rule.kinds.includes(component.kind)) continue;
      let hits;
      try {
        hits = rule.check(component, context);
      } catch {
        findings.push({ rule: rule.id, level: 'info', kind: component.kind, file: component.file, name: component.name, message: 'the rule failed on this component, so it was not checked' });
        continue;
      }
      const seen = new Set<string>();
      let kept = 0;
      for (const hit of hits) {
        // A script a command runs is named relative to the project, a skill's file relative to the skill's folder.
        const folder = component.filesRoot === 'project' ? '' : component.file.slice(0, component.file.lastIndexOf('/') + 1);
        const file = hit.inFile === undefined ? component.file : `${folder}${hit.inFile}`;
        const key = `${file}\0${hit.line ?? ''}\0${hit.column ?? ''}\0${hit.message}`;
        const global = `${rule.id}\0${component.name}\0${key}`;
        if (seen.has(key) || reported.has(global)) continue;
        seen.add(key);
        reported.add(global);
        if (kept++ === MAX_HITS) {
          findings.push({ rule: rule.id, level: 'info', kind: component.kind, file: component.file, name: component.name, message: `${hits.length - MAX_HITS} more findings of this rule were left out` });
          break;
        }
        findings.push({
          rule: rule.id,
          level: LEVELS.includes(hit.level as Level) ? (hit.level as Level) : rule.level,
          kind: component.kind,
          file,
          name: component.name,
          ...(hit.line === undefined ? {} : { line: hit.line }),
          ...(hit.column === undefined ? {} : { column: hit.column }),
          message: quote(hit.message, 400),
          ...(hit.tag === undefined ? {} : { tag: hit.tag }),
        });
      }
    }
  }
  for (const rule of selected) {
    if (rule.checkProject === undefined) continue;
    let hits: readonly ProjectHit[];
    try {
      hits = rule.checkProject(inventory, context);
    } catch {
      findings.push({ rule: rule.id, level: 'info', kind: 'context-file', file: '.', name: '.', message: 'the rule failed on this project, so it was not checked' });
      continue;
    }
    for (const hit of hits) {
      findings.push({
        rule: rule.id,
        level: LEVELS.includes(hit.level as Level) ? (hit.level as Level) : rule.level,
        kind: hit.kind,
        file: hit.file,
        name: hit.name,
        message: quote(hit.message, 400),
      });
    }
  }
  return findings.sort(
    (a, b) =>
      compare(a.file, b.file) || compare(a.line ?? 0, b.line ?? 0) || compare(a.column ?? 0, b.column ?? 0) || compare(a.rule, b.rule) || compare(a.name, b.name) || compare(a.kind, b.kind) || compare(a.message, b.message),
  );
}
