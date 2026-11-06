import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { scanInventory } from '../inventory/index.ts';
import type { Component, Inventory, InventoryProblem } from '../inventory/index.ts';
import { EXIT_FAILURE, EXIT_OK } from './io.ts';
import type { CliIo } from './io.ts';
import { printable, printableJson } from './printable.ts';

/** Version of the JSON that scan --inventory --json prints. */
export const INVENTORY_SCHEMA_VERSION = 1;

const PROBLEMS: Readonly<Record<InventoryProblem['code'], string>> = {
  'outside-project': 'a link that leaves the project, so it was not followed',
  'too-large': 'a file over the size limit, so it was not read',
  'too-deep': 'nested deeper than the limit, so it was not searched further',
  'too-many-entries': 'more entries than the limit, so the inventory is incomplete',
  unreadable: 'could not be read',
  unparsable: 'could not be parsed, so nothing in it was listed',
};

function publicComponent(component: Component): object {
  const { raw, ...visible } = component;
  return { ...visible, bytes: Buffer.byteLength(raw) };
}

function renderText(inventory: Inventory): string {
  const lines = [`${inventory.components.length} ${inventory.components.length === 1 ? 'component' : 'components'} found`];
  for (const component of inventory.components) {
    const name = component.name === component.file.slice(component.file.lastIndexOf('/') + 1) ? '' : ` (${component.name})`;
    lines.push(`  ${component.kind}: ${printable(component.file)}${printable(name)} [${component.agents.join(', ')}]`);
  }
  if (inventory.problems.length > 0) lines.push('', `${inventory.problems.length} ${inventory.problems.length === 1 ? 'problem' : 'problems'}:`);
  for (const problem of inventory.problems) lines.push(`  ${problem.code}: ${printable(problem.file)}: ${PROBLEMS[problem.code]}`);
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
    },
  });
  if (positionals.length > 1) return usageError(`scan takes one directory, got ${positionals.length}`);
  if (values.inventory !== true) return usageError('scan needs --inventory for now: the rules are not available yet');
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
  if (values.json === true) {
    const output = { schemaVersion: INVENTORY_SCHEMA_VERSION, components: inventory.components.map(publicComponent), problems: inventory.problems };
    io.stdout(`${printableJson(output)}\n`);
  } else {
    io.stdout(renderText(inventory));
  }
  return EXIT_OK;
}
