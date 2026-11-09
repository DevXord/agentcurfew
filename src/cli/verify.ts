import { analyzeProject } from '../analyze.ts';
import { buildLock, serializeLock } from '../lock/build.ts';
import { carryExecutableBits, diffLocks, hasIds } from '../lock/diff.ts';
import { sha256 } from '../lock/hash.ts';
import { producer } from './producer.ts';
import type { Change } from '../lock/diff.ts';
import { LOCKFILE } from '../lock/types.ts';
import { skillsLockMismatch } from '../rules/rules/skills-lock-mismatch.ts';
import { parseCommand } from './commands.ts';
import { EXIT_FAILURE, EXIT_OK } from './io.ts';
import type { CliIo } from './io.ts';
import { printable, printableJson } from './printable.ts';
import { policyError, projectRoot } from './project.ts';
import { label } from './style.ts';
import { UNCHECKED_PROBLEMS } from '../inventory/types.ts';
import { problemLines } from './scan.ts';

/** Version of the JSON that verify --json prints. */
export const VERIFY_SCHEMA_VERSION = 1;

function changeLines(change: Change): string[] {
  const base = change.file.slice(change.file.lastIndexOf('/') + 1);
  const name = change.name === base || change.file.includes(`/${change.name}/`) ? '' : ` (${change.name})`;
  return [`  ${change.type}: ${change.kind} ${printable(change.file)}${printable(name)}`, ...change.details.map((detail) => `    ${printable(detail)}`)];
}

export function runVerify(argv: readonly string[], io: CliIo, usageError: (what: string) => number): number {
  const { values, positionals } = parseCommand('verify', argv);
  const root = projectRoot(positionals, io, usageError, 'verify');
  if (typeof root === 'number') return root;
  const analysis = analyzeProject(root, { rules: false });
  if (analysis.policy.status === 'invalid') return policyError(io, analysis.policy.issues);
  const { context, lock, inventory } = analysis;
  if (lock.status !== 'ok') {
    const what = lock.status === 'missing' ? `no ${LOCKFILE} in this project` : `${LOCKFILE} cannot be used, because ${lock.reason}`;
    io.stderr(`agentcurfew: ${what}\n  in: ${LOCKFILE}\n  fix: run agentcurfew lock, review the file and commit it\n`);
    return EXIT_FAILURE;
  }
  const options = context.compareExecutableBits === undefined ? {} : { compareExecutableBits: context.compareExecutableBits };
  const current = buildLock(inventory, context.knowledge);
  const changes = diffLocks(lock.lock, current, options);
  const skills = skillsLockMismatch.checkProject?.(inventory, context) ?? [];
  // The checksum of the lock that agentcurfew lock would write now, to compare states without sending the lock.
  const lockDigest = sha256(serializeLock(context.compareExecutableBits === false ? carryExecutableBits(current, lock.lock) : current));
  const noIds = !hasIds(lock.lock);
  // A file that could not be read was not compared, so verify fails on it as scan does (review of 2026-11-09).
  const unchecked = inventory.problems.filter((problem) => UNCHECKED_PROBLEMS.includes(problem.code));
  const ok = changes.length === 0 && unchecked.length === 0;
  if (values.json === true) {
    const output = { schemaVersion: VERIFY_SCHEMA_VERSION, producer: producer(), ok, changes, lockDigest, ...(noIds ? { lockWithoutIds: true } : {}), ...(lock.lock.unknownKinds === undefined ? {} : { unknownKinds: lock.lock.unknownKinds }), skillsLock: skills, problems: inventory.problems };
    io.stdout(`${printableJson(output)}\n`);
    return ok ? EXIT_OK : EXIT_FAILURE;
  }
  const lines = changes.length === 0 ? [`${label(io, 'OK')}: matches ${LOCKFILE} (${lock.lock.components.length} ${lock.lock.components.length === 1 ? "component" : "components"})`] : [`${label(io, 'Drift')}: ${changes.length} ${changes.length === 1 ? 'change' : 'changes'} since ${LOCKFILE}`, ...changes.flatMap(changeLines)];
  if (skills.length > 0) {
    lines.push('', 'skills-lock.json (does not change the result):');
    for (const hit of skills) lines.push(`  ${label(io, (hit.level ?? 'medium').toUpperCase())}  ${printable(hit.file)}: ${printable(hit.message)}`);
  }
  if (noIds) lines.push('', `Note: ${LOCKFILE} was written before component ids; run agentcurfew lock to add them.`);
  const unknown = lock.lock.unknownKinds;
  if (unknown !== undefined) lines.push('', `Note: ${unknown} ${unknown === 1 ? 'component of a kind this version of agentcurfew does not know was' : 'components of kinds this version of agentcurfew does not know were'} not compared; a newer agentcurfew wrote ${LOCKFILE}.`);
  lines.push(...problemLines(inventory));
  if (unchecked.length > 0) lines.push('', `${label(io, 'Failed')}: ${unchecked.length} ${unchecked.length === 1 ? 'file' : 'files'} could not be read, so ${unchecked.length === 1 ? 'it was' : 'they were'} not compared with ${LOCKFILE}: the too-large, too-deep, too-many-entries and unreadable problems above.`);
  if (changes.length > 0) lines.push('', `If the changes are expected, run agentcurfew lock and commit ${LOCKFILE}.`);
  io.stdout(`${lines.join('\n')}\n`);
  return ok ? EXIT_OK : EXIT_FAILURE;
}
