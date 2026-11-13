import type { InventoryProblem } from '../inventory/types.ts';
import { createHash } from 'node:crypto';
import type { Suppressed } from '../policy/apply.ts';
import { rules } from '../rules/index.ts';
import type { Finding, Level } from '../rules/types.ts';
import { getVersion } from '../version.ts';

const REPOSITORY = 'https://github.com/DevXord/agentcurfew';
const SITE = 'https://agentcurfew.github.io';
const SCHEMA = 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json';

const SARIF_LEVEL: Readonly<Record<Level, 'error' | 'warning' | 'note'>> = { critical: 'error', high: 'error', medium: 'warning', low: 'note', info: 'note' };

/** GitHub Code Scanning reads security-severity from 0 to 10: over 9 is critical, 7 to 8.9 high, 4 to 6.9 medium. */
const SEVERITY: Readonly<Record<Level, string>> = { critical: '9.5', high: '7.5', medium: '5.0', low: '3.0', info: '1.0' };

function fingerprint(finding: Finding): string {
  return createHash('sha256').update([finding.rule, finding.kind, finding.file, finding.name, finding.message].join('\0')).digest('hex').slice(0, 32);
}

/** By the component's id instead of its name, so a finding keeps its identity when a hook is added before it (D-043). */
function fingerprintById(finding: Finding): string {
  return createHash('sha256').update([finding.rule, finding.kind, finding.file, finding.componentId ?? finding.name, finding.message].join('\0')).digest('hex').slice(0, 32);
}

function result(finding: Finding, ruleIndex: number, suppressed?: Suppressed): object {
  const region = finding.line === undefined ? undefined : { startLine: finding.line, ...(finding.column === undefined ? {} : { startColumn: finding.column }) };
  return {
    ruleId: finding.rule,
    ruleIndex,
    level: SARIF_LEVEL[finding.level],
    message: { text: `${finding.message} (${finding.kind} ${finding.name})` },
    locations: [{ physicalLocation: { artifactLocation: artifactLocation(finding.file), ...(region === undefined ? {} : { region }) } }],
    partialFingerprints: { 'agentcurfew/v1': fingerprint(finding), 'agentcurfew/v2': fingerprintById(finding) },
    properties: { level: finding.level, kind: finding.kind, component: finding.name, componentId: finding.componentId ?? finding.name, ...(finding.policy === undefined ? {} : { policy: finding.policy }) },
    ...(suppressed === undefined ? {} : { suppressions: [{ kind: 'external', justification: suppressed.reason }] }),
  };
}

/**
 * Where a file is, for SARIF: relative to the repository (%SRCROOT%), to the user's home folder (HOME, for --user files
 * that start with ~/), or an absolute file: URI for machine files (review of 2026-11-09: ~/ under %SRCROOT% named a path
 * inside the repository that does not exist).
 */
function artifactLocation(file: string): { uri: string; uriBaseId?: string } {
  if (file.startsWith('~/')) return { uri: fileUri(file.slice(2)), uriBaseId: 'HOME' };
  if (/^(?:\/|[A-Za-z]:\/)/.test(file)) return { uri: `file://${file.startsWith('/') ? '' : '/'}${fileUri(file)}` };
  return { uri: fileUri(file), uriBaseId: '%SRCROOT%' };
}

/** A relative path as a URI reference: each segment percent-encoded, so that a space, # or % in a file name stays a name. */
function fileUri(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

/**
 * The findings of a scan as SARIF 2.1.0, for GitHub Code Scanning and other tools. Deterministic: no time stamps, no
 * absolute paths. Findings accepted by the policy are kept, with the exception's reason as a suppression.
 */
export function toSarif(findings: readonly Finding[], suppressed: readonly Suppressed[], unchecked: readonly InventoryProblem[] = []): object {
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
              helpUri: `${SITE}/rules#${rule.id}`,
              defaultConfiguration: { level: SARIF_LEVEL[rule.level] },
              properties: { tags: ['security', ...rule.owasp.map((id) => `external/owasp-ast/${id.toLowerCase()}`)], 'security-severity': SEVERITY[rule.level], precision: rule.falsePositives === undefined ? 'high' : 'medium' },
            })),
          },
        },
        // Files that could not be read were not checked: the run did not succeed, and each is a notification (Q-013).
        ...(unchecked.length === 0
          ? {}
          : {
              invocations: [
                {
                  executionSuccessful: false,
                  toolExecutionNotifications: unchecked.map((problem) => ({
                    level: 'error',
                    message: { text: `${problem.code}: the file could not be read, so it was not checked` },
                    locations: [{ physicalLocation: { artifactLocation: artifactLocation(problem.file) } }],
                  })),
                },
              ],
            }),
        ...([...findings, ...suppressed.map((item) => item.finding)].some((finding) => finding.file.startsWith('~/')) ? { originalUriBaseIds: { HOME: { description: { text: "The user's home folder." } } } } : {}),
        columnKind: 'unicodeCodePoints',
        results: [
          ...findings.map((finding) => result(finding, index.get(finding.rule) ?? 0)),
          ...suppressed.map((item) => result(item.finding, index.get(item.finding.rule) ?? 0, item)),
        ],
      },
    ],
  };
}
