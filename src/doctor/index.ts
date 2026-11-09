import { analyzeProject } from '../analyze.ts';
import type { DoctorLevel } from '../policy/types.ts';
import { quote } from '../rules/mask.ts';
import { checks } from './checks.ts';
import type { DoctorCheck, DoctorHit } from './types.ts';

export const DOCTOR_LEVELS: readonly DoctorLevel[] = ['error', 'warning', 'info'];

export interface CheckResult {
  id: string;
  title: string;
  status: 'passed' | 'failed' | 'not applicable';
  hits: { file: string; message: string; level: DoctorLevel; sources: string[] }[];
  fix: string;
}

export function doctorAtLeast(level: DoctorLevel, threshold: DoctorLevel): boolean {
  return DOCTOR_LEVELS.indexOf(level) <= DOCTOR_LEVELS.indexOf(threshold);
}

/** Runs every check on a project. A check that throws is reported as failed at info, and the others still run. */
export function runDoctor(root: string, options: { user?: boolean; now?: Date; only?: readonly DoctorCheck[] } = {}): { results: CheckResult[]; failOn?: DoctorLevel | 'none' } {
  const analysis = analyzeProject(root, { user: options.user === true, ...(options.now === undefined ? {} : { now: options.now }) });
  const context = { root, analysis, user: options.user === true };
  const results: CheckResult[] = [];
  for (const check of options.only ?? checks) {
    let applies: boolean;
    let hits: DoctorHit[];
    try {
      applies = check.applies(context);
      hits = applies ? check.run(context) : [];
    } catch {
      applies = true;
      hits = [{ file: '.', message: 'the check failed on this project', level: 'info' }];
    }
    const sorted = hits
      .map((hit) => ({ file: hit.file, message: quote(hit.message, 600), level: hit.level ?? check.level, sources: hit.sources ?? [...check.sources] }))
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
    results.push({ id: check.id, title: check.title, status: !applies ? 'not applicable' : sorted.length === 0 ? 'passed' : 'failed', hits: sorted, fix: check.fix });
  }
  const failOn = analysis.context.policy?.doctor?.failOn;
  return failOn === undefined ? { results } : { results, failOn };
}
