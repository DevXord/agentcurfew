import { runHook } from '../hook/index.ts';
import { parseCommand } from './commands.ts';
import { EXIT_OK } from './io.ts';
import type { CliIo } from './io.ts';

/** agentcurfew hook: always exits 0, since exit code 2 would block the call whatever the JSON says. */
export async function runHookCommand(argv: readonly string[], io: CliIo, usageError: (what: string) => number): Promise<number> {
  const { positionals } = parseCommand('hook', argv);
  if (positionals.length > 0) return usageError(`hook takes no arguments, got ${positionals.length}`);
  const input = io.stdin === undefined ? '' : await io.stdin();
  const { stdout, stderr } = runHook(input, process.env, process.cwd());
  if (stdout !== '') io.stdout(stdout);
  if (stderr !== '') io.stderr(stderr);
  return EXIT_OK;
}
