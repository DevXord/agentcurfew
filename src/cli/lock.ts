import { lstatSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { scanInventory } from '../inventory/index.ts';
import { buildLock, serializeLock } from '../lock/build.ts';
import { projectContext } from '../lock/context.ts';
import { carryExecutableBits } from '../lock/diff.ts';
import { LOCKFILE } from '../lock/types.ts';
import { atLeast, runRules } from '../rules/index.ts';
import { EXIT_FAILURE, EXIT_OK } from './io.ts';
import type { CliIo } from './io.ts';
import { projectRoot } from './project.ts';
import { problemLines } from './scan.ts';

export function runLock(argv: readonly string[], io: CliIo, usageError: (what: string) => number): number {
  const { positionals } = parseArgs({ args: [...argv], allowPositionals: true, options: {} });
  const root = projectRoot(positionals, io, usageError, 'lock');
  if (typeof root === 'number') return root;
  const path = join(root, LOCKFILE);
  try {
    if (lstatSync(path).isSymbolicLink()) {
      io.stderr(`agentcurfew: ${LOCKFILE} is a link, so it was not written\n  in: ${LOCKFILE}\n  fix: replace the link with a regular file, or delete it\n`);
      return EXIT_FAILURE;
    }
  } catch {
    // No lock yet.
  }
  const inventory = scanInventory({ root });
  const { context, lock: previous } = projectContext(root);
  let lock = buildLock(inventory, context.knowledge);
  if (context.compareExecutableBits === false) lock = carryExecutableBits(lock, previous.status === 'ok' ? previous.lock : undefined);
  const text = serializeLock(lock);
  const count = `${lock.components.length} ${lock.components.length === 1 ? 'component' : 'components'}`;
  const lines: string[] = [];
  if (previous.status === 'ok' && previous.text === text) {
    lines.push(`${LOCKFILE} is up to date: ${count}`);
  } else {
    writeFileSync(path, text);
    lines.push(`${previous.status === 'missing' ? 'Wrote' : 'Updated'} ${LOCKFILE}: ${count}`);
    if (previous.status === 'invalid') lines.push(`  the old file was replaced, because ${previous.reason}`);
  }
  const serious = runRules(inventory, { context: { knowledge: context.knowledge } }).filter((finding) => atLeast(finding.level, 'high')).length;
  if (serious > 0) {
    lines.push(`Warning: ${serious} ${serious === 1 ? 'finding' : 'findings'} at level high or above are now locked as they are; run agentcurfew scan to see them.`);
  }
  lines.push(...problemLines(inventory));
  io.stdout(`${lines.join('\n')}\n`);
  return EXIT_OK;
}
