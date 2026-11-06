import { createHash } from 'node:crypto';
import type { Suppressed } from '../policy/apply.ts';
import { rules } from '../rules/index.ts';
import type { Finding, Level } from '../rules/types.ts';
import { getVersion } from '../version.ts';

const REPOSITORY = 'https://github.com/DevXord/agentcurfew';
const SCHEMA = 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json';

const SARIF_LEVEL: Readonly<Record<Level, 'error' | 'warning' | 'note'>> = { critical: 'error', high: 'error', medium: 'warning', low: 'note', info: 'note' };

/** GitHub Code Scanning reads security-severity from 0 to 10: over 9 is critical, 7 to 8.9 high, 4 to 6.9 medium. */
const SEVERITY: Readonly<Record<Level, string>> = { critical: '9.5', high: '7.5', medium: '5.0', low: '3.0', info: '1.0' };

function fingerprint(finding: Finding): string {
  return createHash('sha256').update([finding.rule, finding.kind, finding.file, finding.name, finding.message].join('\0')).digest('hex').slice(0, 32);
}

function result(finding: Finding, ruleIndex: number, suppressed?: Suppressed): object {
  const region = finding.line === undefined ? undefined : { startLine: finding.line, ...(finding.column === undefined ? {} : { startColumn: finding.column }) };
  return {
    ruleId: finding.rule,
    ruleIndex,
    level: SARIF_LEVEL[finding.level],
    message: { text: `${finding.message} (${finding.kind} ${finding.name})` },
    locations: [{ physicalLocation: { artifactLocation: { uri: finding.file, uriBaseId: '%SRCROOT%' }, ...(region === undefined ? {} : { region }) } }],
    partialFingerprints: { 'agentcurfew/v1': fingerprint(finding) },
    properties: { level: finding.level, kind: finding.kind, component: finding.name, ...(finding.policy === undefined ? {} : { policy: finding.policy }) },
    ...(suppressed === undefined ? {} : { suppressions: [{ kind: 'external', justification: suppressed.reason }] }),
  };
}

/**
 * The findings of a scan as SARIF 2.1.0, for GitHub Code Scanning and other tools. Deterministic: no time stamps, no
 * absolute paths. Findings accepted by the policy are kept, with the exception's reason as a suppression.
 */
export function toSarif(findings: readonly Finding[], suppressed: readonly Suppressed[]): object {
  const index = new Map(rules.map((rule, position) => [rule.id, position]));
  return {
    $schema: SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'agentcurfew',
            version: getVersion(),
            informationUri: REPOSITORY,
            rules: rules.map((rule) => ({
              id: rule.id,
              name: rule.id
                .split('-')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(''),
              shortDescription: { text: rule.title },
              fullDescription: { text: rule.description },
              help: { text: `${rule.fix}${rule.falsePositives === undefined ? '' : `\n\nFalse alarms: ${rule.falsePositives}`}` },
              helpUri: `${REPOSITORY}/blob/main/docs/rules.md#${rule.id}`,
              defaultConfiguration: { level: SARIF_LEVEL[rule.level] },
              properties: { tags: ['security', ...rule.owasp.map((id) => `external/owasp-ast/${id.toLowerCase()}`)], 'security-severity': SEVERITY[rule.level], precision: rule.falsePositives === undefined ? 'high' : 'medium' },
            })),
          },
        },
        columnKind: 'unicodeCodePoints',
        results: [
          ...findings.map((finding) => result(finding, index.get(finding.rule) ?? 0)),
          ...suppressed.map((item) => result(item.finding, index.get(item.finding.rule) ?? 0, item)),
        ],
      },
    ],
  };
}
