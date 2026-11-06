import { parseArgs } from 'node:util';
import { DOCTOR_LEVELS, doctorAtLeast, runDoctor } from '../doctor/index.ts';
import type { DoctorLevel } from '../policy/types.ts';
import { EXIT_FAILURE, EXIT_OK } from './io.ts';
import type { CliIo } from './io.ts';
import { printable, printableJson } from './printable.ts';
import { projectRoot } from './project.ts';

/** Version of the JSON that doctor --json prints. */
export const DOCTOR_SCHEMA_VERSION = 1;

const FAIL_ON = [...DOCTOR_LEVELS, 'none'] as const;

export function runDoctorCommand(argv: readonly string[], io: CliIo, usageError: (what: string) => number): number {
  const { values, positionals } = parseArgs({ args: [...argv], allowPositionals: true, options: { json: { type: 'boolean' }, user: { type: 'boolean' }, 'fail-on': { type: 'string' } } });
  const flag = values['fail-on'] as DoctorLevel | 'none' | undefined;
  if (flag !== undefined && !FAIL_ON.includes(flag)) return usageError(`--fail-on takes one of ${FAIL_ON.join(', ')}, got ${flag}`);
  const root = projectRoot(positionals, io, usageError, 'doctor');
  if (typeof root === 'number') return root;
  const { results, failOn: fromPolicy } = runDoctor(root, { user: values.user === true });
  const failOn = flag ?? fromPolicy ?? 'warning';
  const failing = failOn === 'none' ? [] : results.flatMap((result) => result.hits).filter((hit) => doctorAtLeast(hit.level, failOn));
  if (values.json === true) {
    io.stdout(`${printableJson({ schemaVersion: DOCTOR_SCHEMA_VERSION, failOn, ok: failing.length === 0, checks: results })}\n`);
    return failing.length === 0 ? EXIT_OK : EXIT_FAILURE;
  }
  const count = (status: string) => results.filter((result) => result.status === status).length;
  const lines = [`${results.length} checks: ${count('passed')} passed, ${count('failed')} failed, ${count('not applicable')} not applicable`];
  for (const result of results) lines.push(`  ${result.status.padEnd(14)}  ${result.title} [${result.id}]`);
  for (const result of results) {
    for (const hit of result.hits) {
      lines.push('', `${hit.level.toUpperCase()}  ${result.id}  ${printable(hit.file)}`, `  ${printable(hit.message)}`, `  fix: ${result.fix}`);
      if (hit.sources.length > 0) lines.push(`  source: ${hit.sources.join(', ')}`);
    }
  }
  if (failing.length > 0) lines.push('', `Failed: ${failing.length} ${failing.length === 1 ? 'problem' : 'problems'} at level ${failOn} or above (change with --fail-on or doctor.failOn).`);
  io.stdout(`${lines.join('\n')}\n`);
  return failing.length === 0 ? EXIT_OK : EXIT_FAILURE;
}
