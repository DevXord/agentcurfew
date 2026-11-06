import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { scanInventory } from '../inventory/index.ts';
import type { Component, Inventory, InventoryProblem } from '../inventory/index.ts';
import { atLeast, LEVELS, runRules } from '../rules/index.ts';
import type { Finding, Level } from '../rules/index.ts';
import { EXIT_FAILURE, EXIT_OK } from './io.ts';
import type { CliIo } from './io.ts';
import { printable, printableJson } from './printable.ts';

/** Version of the JSON that scan --inventory --json prints. */
export const INVENTORY_SCHEMA_VERSION = 1;

/** Version of the JSON that scan --json prints: the inventory's fields, plus findings. */
export const SCAN_SCHEMA_VERSION = 2;

const FAIL_ON = [...LEVELS.filter((level) => level !== 'info'), 'none'] as const;
type FailOn = (typeof FAIL_ON)[number];

const PROBLEMS: Readonly<Record<InventoryProblem['code'], string>> = {
  'outside-project': 'a link that leaves the project, so it was not followed',
  'too-large': 'a file over the size limit, so it was not read',
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

function problemLines(inventory: Inventory): string[] {
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

function renderFindings(inventory: Inventory, findings: readonly Finding[], failOn: FailOn): string {
  const counts = LEVELS.map((level) => [level, findings.filter((finding) => finding.level === level).length] as const).filter(([, count]) => count > 0);
  const summary = counts.length === 0 ? '' : ` (${counts.map(([level, count]) => `${count} ${level}`).join(', ')})`;
  const lines = [`${plural(inventory.components.length, 'component')} scanned, ${plural(findings.length, 'finding')}${summary}`];
  let rule = '';
  for (const finding of findings) {
    lines.push('', `${finding.level.toUpperCase()}  ${finding.rule}  ${where(finding)}`, `  ${printable(finding.message)}`);
    if (finding.rule !== rule) lines.push(`  more: agentcurfew explain ${finding.rule}`);
    rule = finding.rule;
  }
  lines.push(...problemLines(inventory));
  const failing = failOn === 'none' ? 0 : findings.filter((finding) => atLeast(finding.level, failOn)).length;
  if (failing > 0) lines.push('', `Failed: ${plural(failing, 'finding')} at level ${failOn} or above (change with --fail-on).`);
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

export function runScan(argv: readonly string[], io: CliIo, usageError: (what: string) => number): number {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      inventory: { type: 'boolean' },
      json: { type: 'boolean' },
      user: { type: 'boolean' },
      'fail-on': { type: 'string' },
    },
  });
  if (positionals.length > 1) return usageError(`scan takes one directory, got ${positionals.length}`);
  const failOn = (values['fail-on'] ?? 'high') as FailOn;
  if (!FAIL_ON.includes(failOn)) return usageError(`--fail-on takes one of ${FAIL_ON.join(', ')}, got ${values['fail-on']}`);
  if (values.inventory === true && values['fail-on'] !== undefined) return usageError('--fail-on applies to the rules, so it cannot be used with --inventory');
  const root = resolve(positionals[0] ?? '.');
  let directory = false;
  try {
    directory = statSync(root).isDirectory();
  } catch {
    directory = false;
  }
  if (!directory) {
    io.stderr(`agentcurfew: not a directory: ${printable(positionals[0] ?? '.')}\n  in: the command line\n  fix: pass the directory of a project\n`);
    return EXIT_FAILURE;
  }
  const inventory = scanInventory({ root, user: values.user === true });
  if (values.inventory === true) {
    if (values.json === true) {
      const output = { schemaVersion: INVENTORY_SCHEMA_VERSION, components: inventory.components.map(publicComponent), problems: inventory.problems };
      io.stdout(`${printableJson(output)}\n`);
    } else {
      io.stdout(renderText(inventory));
    }
    return EXIT_OK;
  }
  const findings = runRules(inventory);
  if (values.json === true) {
    const output = { schemaVersion: SCAN_SCHEMA_VERSION, failOn, components: inventory.components.map(publicComponent), findings, problems: inventory.problems };
    io.stdout(`${printableJson(output)}\n`);
  } else {
    io.stdout(renderFindings(inventory, findings, failOn));
  }
  const failed = failOn !== 'none' && findings.some((finding) => atLeast(finding.level, failOn as Level));
  return failed ? EXIT_FAILURE : EXIT_OK;
}
