const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FACT_STATUSES = new Set(['verified', 'uncertain', 'disputed']);

export const AGENT_FIELDS = ['precedence', 'mcp', 'hooks', 'skills', 'contextFiles', 'permissions', 'autoRun', 'extensions'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function checkEvidence(evidence: Record<string, unknown>, path: string, issues: string[]): void {
  if (!isHttpsUrl(evidence.source)) issues.push(`${path}: source must be an https URL`);
  if (typeof evidence.verifiedAt !== 'string' || !DATE.test(evidence.verifiedAt)) issues.push(`${path}: verifiedAt must be YYYY-MM-DD`);
  if (!('value' in evidence)) issues.push(`${path}: value is missing`);
}

function checkFact(fact: Record<string, unknown>, path: string, issues: string[]): void {
  if (fact.status === 'disputed') {
    if (typeof fact.note !== 'string' || fact.note === '') issues.push(`${path}: a disputed fact needs a note`);
    const variants = fact.variants;
    if (!Array.isArray(variants) || variants.length < 2) {
      issues.push(`${path}: a disputed fact needs at least two variants`);
      return;
    }
    variants.forEach((variant: unknown, index) => {
      if (isRecord(variant)) checkEvidence(variant, `${path}.variants[${index}]`, issues);
      else issues.push(`${path}.variants[${index}]: not an object`);
    });
    return;
  }
  checkEvidence(fact, path, issues);
  if (fact.status === 'uncertain' && (typeof fact.note !== 'string' || fact.note === '')) issues.push(`${path}: an uncertain fact needs a note`);
}

/** Issues of every fact in a knowledge entry; a field listed in `required` must be a fact itself. */
export function validateKnowledge(entry: Readonly<Record<string, unknown>>, required: readonly string[], label: string): string[] {
  const issues: string[] = [];
  for (const field of required) {
    const value = entry[field];
    if (!isRecord(value) || !FACT_STATUSES.has(String(value.status))) issues.push(`${label}.${field}: must be a fact with a source and a date`);
  }
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`));
    if (!isRecord(value)) return;
    if (FACT_STATUSES.has(String(value.status))) {
      checkFact(value, path, issues);
      return;
    }
    for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
  };
  walk(entry, label);
  return issues;
}
