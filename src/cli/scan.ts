import { analyzeProjectAsync } from '../analyze.ts';
import type { Component, Inventory, InventoryProblem } from '../inventory/index.ts';
import { UNCHECKED_PROBLEMS } from '../inventory/types.ts';
import { LOCKFILE } from '../lock/types.ts';
import type { Suppressed } from '../policy/apply.ts';
import { toSarif } from '../report/sarif.ts';
import { atLeast, LEVELS } from '../rules/index.ts';
import type { Finding, Level } from '../rules/index.ts';
import { parseCommand } from './commands.ts';
import { EXIT_FAILURE, EXIT_OK } from './io.ts';
import type { CliIo } from './io.ts';
import { printable, printableJson } from './printable.ts';
import { policyError, projectRoot } from './project.ts';
import { label } from './style.ts';

/** Version of the JSON that scan --inventory --json prints. */
export const INVENTORY_SCHEMA_VERSION = 1;

/** Version of the JSON that scan --json prints: the inventory's fields, findings, and findings the policy accepted. */
export const SCAN_SCHEMA_VERSION = 3;

const FAIL_ON = [...LEVELS.filter((level) => level !== 'info'), 'none'] as const;
type FailOn = (typeof FAIL_ON)[number];

const PROBLEMS: Readonly<Record<InventoryProblem['code'], string>> = {
  'outside-project': 'a link that leaves the project, so it was not followed',
  'too-large': 'a file over the size limit, or past the limit for the whole scan, so it was not read',
  'too-deep': 'nested deeper than the limit, so it was not searched further',
  'too-many-entries': 'more entries than the limit, so the inventory is incomplete',
  unreadable: 'could not be read',
  unparsable: 'could not be parsed, so nothing in it was listed',
};

/** What may be printed: no file contents, which can hold secrets or hostile text. */
export function publicComponent(component: Component): object {
  const { raw, files, ...visible } = component;
  const listed = files === undefined ? {} : { files: files.map(({ path, bytes }) => ({ path, bytes })) };
  return { ...visible, ...listed, bytes: Buffer.byteLength(raw) };
}

function plural(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

export function problemLines(inventory: Inventory): string[] {
  const lines: string[] = [];
  if (inventory.problems.length > 0) lines.push('', `${plural(inventory.problems.length, 'problem')}:`);
  for (const problem of inventory.problems) lines.push(`  ${problem.code}: ${printable(problem.file)}: ${PROBLEMS[problem.code]}`);
  return lines;
}

function where(finding: Finding): string {
  const place = finding.line === undefined ? '' : `:${finding.line}${finding.column === undefined ? '' : `:${finding.column}`}`;
  const base = finding.file.slice(finding.file.lastIndexOf('/') + 1);
  const name = finding.name === base || finding.file.includes(`/${finding.name}/`) ? '' : ` (${finding.name})`;
  return printable(`${finding.file}${place}${name}`);
}

function renderFindings(io: CliIo, inventory: Inventory, findings: readonly Finding[], suppressed: readonly Suppressed[], failOn: FailOn, unchecked: number): string {
  const counts = LEVELS.map((level) => [level, findings.filter((finding) => finding.level === level).length] as const).filter(([, count]) => count > 0);
  const summary = counts.length === 0 ? '' : ` (${counts.map(([level, count]) => `${count} ${level}`).join(', ')})`;
  const lines = [`${plural(inventory.components.length, 'component')} scanned, ${plural(findings.length, 'finding')}${summary}`];
  let rule = '';
  for (const finding of findings) {
    const set = finding.policy === undefined ? '' : ` (level set by policy: ${finding.policy})`;
    lines.push('', `${label(io, finding.level.toUpperCase())}  ${finding.rule}  ${where(finding)}${set}`, `  ${printable(finding.message)}`);
    if (finding.rule !== rule) lines.push(`  more: agentcurfew explain ${finding.rule}`);
    rule = finding.rule;
  }
  if (suppressed.length > 0) lines.push('', `${plural(suppressed.length, 'finding')} accepted by exceptions in agentcurfew.policy.json (see --json).`);
  lines.push(...problemLines(inventory));
  const failing = failOn === 'none' ? 0 : findings.filter((finding) => atLeast(finding.level, failOn)).length;
  if (failing > 0) lines.push('', `${label(io, 'Failed')}: ${plural(failing, 'finding')} at level ${failOn} or above (change with --fail-on).`);
  if (failOn !== 'none' && unchecked > 0) lines.push('', `${label(io, 'Failed')}: ${plural(unchecked, 'file')} could not be read, so ${unchecked === 1 ? 'it was' : 'they were'} not checked (see the problems above).`);
  return `${lines.join('\n')}\n`;
}

function renderText(inventory: Inventory): string {
  const lines = [`${inventory.components.length} ${inventory.components.length === 1 ? 'component' : 'components'} found`];
  for (const component of inventory.components) {
    const name = component.name === component.file.slice(component.file.lastIndexOf('/') + 1) ? '' : ` (${component.name})`;
    lines.push(`  ${component.kind}: ${printable(component.file)}${printable(name)} [${component.agents.join(', ')}]`);
  }
  lines.push(...problemLines(inventory));
  return `${lines.join('\n')}\n`;
}

export async function runScan(argv: readonly string[], io: CliIo, usageError: (what: string) => number): Promise<number> {
  const { values, positionals } = parseCommand('scan', argv);
  const flag = values['fail-on'] as FailOn | undefined;
  if (flag !== undefined && !FAIL_ON.includes(flag)) return usageError(`--fail-on takes one of ${FAIL_ON.join(', ')}, got ${flag}`);
  if (values.inventory === true && flag !== undefined) return usageError('--fail-on applies to the rules, so it cannot be used with --inventory');
  if (values.sarif === true && (values.json === true || values.inventory === true)) return usageError('--sarif cannot be combined with --json or --inventory');
  const root = projectRoot(positionals, io, usageError, 'scan');
  if (typeof root === 'number') return root;
  const analysis = await analyzeProjectAsync(root, { user: values.user === true, rules: values.inventory !== true });
  if (analysis.policy.status === 'invalid') return policyError(io, analysis.policy.issues);
  const { inventory, findings, suppressed, lock } = analysis;
  const failOn: FailOn = flag ?? analysis.context.policy?.failOn ?? 'high';
  if (values.inventory === true) {
    if (values.json === true) {
      const output = { schemaVersion: INVENTORY_SCHEMA_VERSION, components: inventory.components.map(publicComponent), problems: inventory.problems };
      io.stdout(`${printableJson(output)}\n`);
    } else {
      io.stdout(renderText(inventory));
    }
    return EXIT_OK;
  }
  // A file that could not be read was not checked, so it fails the scan as a finding would (Q-013).
  const unchecked = inventory.problems.filter((problem) => UNCHECKED_PROBLEMS.includes(problem.code));
  if (values.sarif === true) {
    io.stdout(`${printableJson(toSarif(findings, suppressed, unchecked))}\n`);
  } else if (values.json === true) {
    const output = { schemaVersion: SCAN_SCHEMA_VERSION, failOn, components: inventory.components.map(publicComponent), findings, suppressed, problems: inventory.problems };
    io.stdout(`${printableJson(output)}\n`);
  } else {
    const note = lock.status === 'invalid' ? `\nNote: ${LOCKFILE} was not compared, because ${lock.reason}.\n` : '';
    io.stdout(renderFindings(io, inventory, findings, suppressed, failOn, unchecked.length) + note);
  }
  const failed = failOn !== 'none' && (unchecked.length > 0 || findings.some((finding) => atLeast(finding.level, failOn as Level)));
  return failed ? EXIT_FAILURE : EXIT_OK;
}
