import type { Analysis } from '../analyze.ts';
import type { DoctorLevel } from '../policy/types.ts';

export interface DoctorContext {
  root: string;
  analysis: Analysis;
  /** Whether the user's and the machine's files were read too. */
  user: boolean;
}

export interface DoctorHit {
  file: string;
  /** Safe to print: names, paths and the agent's own words only. */
  message: string;
  level?: DoctorLevel;
  /** Where the fact behind this hit comes from; the check's sources when absent. */
  sources?: string[];
}

export interface DoctorCheck {
  id: string;
  title: string;
  level: DoctorLevel;
  description: string;
  fix: string;
  /** Where the facts the check rests on come from. */
  sources: readonly string[];
  /** Whether there is anything to check in this project; a check that does not apply is reported as such. */
  applies(context: DoctorContext): boolean;
  run(context: DoctorContext): DoctorHit[];
}
