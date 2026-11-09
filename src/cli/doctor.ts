import { DOCTOR_LEVELS, doctorAtLeast, runDoctor } from '../doctor/index.ts';
import type { DoctorLevel } from '../policy/types.ts';
import { parseCommand } from './commands.ts';
import { EXIT_FAILURE, EXIT_OK } from './io.ts';
import type { CliIo } from './io.ts';
import { printable, printableJson } from './printable.ts';
import { projectRoot } from './project.ts';
import { producer } from './producer.ts';
import { label } from './style.ts';

/** Version of the JSON that doctor --json prints. */
export const DOCTOR_SCHEMA_VERSION = 1;

const FAIL_ON = [...DOCTOR_LEVELS, 'none'] as const;

export function runDoctorCommand(argv: readonly string[], io: CliIo, usageError: (what: string) => number): number {
  const { values, positionals } = parseCommand('doctor', argv);
  const flag = values['fail-on'] as DoctorLevel | 'none' | undefined;
  if (flag !== undefined && !FAIL_ON.includes(flag)) return usageError(`--fail-on takes one of ${FAIL_ON.join(', ')}, got ${flag}`);
  const root = projectRoot(positionals, io, usageError, 'doctor');
  if (typeof root === 'number') return root;
  const { results, failOn: fromPolicy } = runDoctor(root, { user: values.user === true });
  const failOn = flag ?? fromPolicy ?? 'warning';
  const failing = failOn === 'none' ? [] : results.flatMap((result) => result.hits).filter((hit) => doctorAtLeast(hit.level, failOn));
  if (values.json === true) {
    io.stdout(`${printableJson({ schemaVersion: DOCTOR_SCHEMA_VERSION, producer: producer(), failOn, ok: failing.length === 0, checks: results })}\n`);
    return failing.length === 0 ? EXIT_OK : EXIT_FAILURE;
  }
  const count = (status: string) => results.filter((result) => result.status === status).length;
  const lines = [`${results.length} checks: ${count('passed')} passed, ${count('failed')} failed, ${count('not applicable')} not applicable`];
  for (const result of results) lines.push(`  ${label(io, result.status)}${' '.repeat(14 - result.status.length)}  ${result.title} [${result.id}]`);
  for (const result of results) {
    for (const hit of result.hits) {
      lines.push('', `${label(io, hit.level.toUpperCase())}  ${result.id}  ${printable(hit.file)}`, `  ${printable(hit.message)}`, `  fix: ${result.fix}`);
      if (hit.sources.length > 0) lines.push(`  source: ${hit.sources.join(', ')}`);
    }
  }
  if (failing.length > 0) lines.push('', `${label(io, 'Failed')}: ${failing.length} ${failing.length === 1 ? 'problem' : 'problems'} at level ${failOn} or above (change with --fail-on or doctor.failOn).`);
  io.stdout(`${lines.join('\n')}\n`);
  return failing.length === 0 ? EXIT_OK : EXIT_FAILURE;
}
