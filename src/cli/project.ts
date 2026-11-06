import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXIT_FAILURE } from './io.ts';
import type { CliIo } from './io.ts';
import { printable } from './printable.ts';

/** The project directory of a command, or the exit code after saying why it is not one. */
export function projectRoot(positionals: readonly string[], io: CliIo, usageError: (what: string) => number, command: string): string | number {
  if (positionals.length > 1) return usageError(`${command} takes one directory, got ${positionals.length}`);
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
  return root;
}

/** Says why the policy cannot be used; commands that apply it stop with this. */
export function policyError(io: CliIo, issues: readonly { path: string; message: string }[]): number {
  const first = issues[0];
  const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : '';
  io.stderr(
    `agentcurfew: agentcurfew.policy.json cannot be used: ${printable(first?.path ?? 'policy')}: ${printable(first?.message ?? 'invalid')}${more}\n  in: agentcurfew.policy.json\n  fix: correct the file; agentcurfew doctor lists every problem\n`,
  );
  return EXIT_FAILURE;
}
