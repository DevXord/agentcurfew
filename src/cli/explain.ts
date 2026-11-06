import { findRule, rules } from '../rules/index.ts';
import { explainText } from '../rules/render.ts';
import { EXIT_FAILURE, EXIT_OK } from './io.ts';
import type { CliIo } from './io.ts';
import { printable } from './printable.ts';

export function runExplain(argv: readonly string[], io: CliIo, usageError: (what: string) => number): number {
  if (argv.length !== 1) return usageError(`explain takes one rule id, got ${argv.length}`);
  const id = argv[0] as string;
  const rule = findRule(id);
  if (rule === undefined) {
    io.stderr(`agentcurfew: unknown rule: ${printable(id)}\n  in: the command line\n  fix: use one of ${rules.map((item) => item.id).join(', ')}\n`);
    return EXIT_FAILURE;
  }
  io.stdout(explainText(rule));
  return EXIT_OK;
}
