import { findRule, rules } from '../rules/index.ts';
import { explainText } from '../rules/render.ts';
import { closest } from '../text/distance.ts';
import { parseCommand } from './commands.ts';
import { EXIT_OK, EXIT_USAGE } from './io.ts';
import type { CliIo } from './io.ts';
import { printable } from './printable.ts';

export function runExplain(argv: readonly string[], io: CliIo, usageError: (what: string) => number): number {
  const { positionals } = parseCommand('explain', argv);
  if (positionals.length !== 1) return usageError(`explain takes one rule id, got ${positionals.length}`);
  const id = positionals[0] as string;
  const rule = findRule(id);
  if (rule === undefined) {
    const ids = rules.map((item) => item.id);
    const near = closest(id, ids);
    const fix = near === undefined ? `use one of ${ids.join(', ')}` : `did you mean ${near}? The rules are ${ids.join(', ')}`;
    io.stderr(`agentcurfew: unknown rule: ${printable(id)}\n  in: the command line\n  fix: ${fix}\n`);
    return EXIT_USAGE;
  }
  io.stdout(explainText(rule));
  return EXIT_OK;
}
