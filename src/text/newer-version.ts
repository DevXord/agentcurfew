// A shared message for a field, rule id or enum value this version does not know.
// Points the reader at a possible typo (closest known name) and at the possibility
// that a newer agentcurfew wrote the file. The caller handles the exit code.

import { getVersion } from '../version.ts';
import { closest } from './distance.ts';

function suggestion(name: string, candidates: readonly string[]): string {
  const best = closest(name, candidates);
  return best === undefined ? '' : ` Did you mean ${JSON.stringify(best)}?`;
}

/** Reports an unknown object field (JSON Schema `additionalProperties: false`). */
export function newerVersionField(name: string, candidates: readonly string[]): string {
  return `is not a known setting in agentcurfew ${getVersion()}; this file may have been written by a newer agentcurfew (upgrade, or remove it).${suggestion(name, candidates)}`;
}

/** Reports an unknown enum string value (e.g. a rule id or a `failOn` level added later). */
export function newerVersionValue(value: string, candidates: readonly string[]): string {
  return `${JSON.stringify(value)} is not a known value in agentcurfew ${getVersion()}; this file may have been written by a newer agentcurfew (upgrade, or remove it).${suggestion(value, candidates)}`;
}
