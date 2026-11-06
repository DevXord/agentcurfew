import { parseArgs } from 'node:util';
import { getVersion } from '../version.ts';
import { EXIT_OK, EXIT_USAGE } from './io.ts';
import type { CliIo } from './io.ts';

const HELP = `agentcurfew: inventory, lock and check what steers your AI coding agents.

Usage: agentcurfew [options]
       acf [options]

Options:
  -h, --help     Show this help
  -v, --version  Show the version

Planned commands, not available yet: scan, lock, verify, init, doctor, explain, mcp
`;

// Arguments can hold escape sequences, which must not reach the terminal.
function printable(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, '?');
}

function usageError(io: CliIo, what: string): number {
  io.stderr(`agentcurfew: ${printable(what)}\n  in: the command line\n  fix: run agentcurfew --help to see what is available\n`);
  return EXIT_USAGE;
}

function isParseError(error: unknown): error is Error {
  return error instanceof Error && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS_');
}

export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    if (isParseError(error)) return usageError(io, error.message.split('\n')[0] ?? 'invalid arguments');
    throw error;
  }

  const [command] = parsed.positionals;
  if (parsed.values.version === true && command === undefined) {
    io.stdout(`${getVersion()}\n`);
    return EXIT_OK;
  }
  if (command === undefined || command === 'help') {
    io.stdout(HELP);
    return EXIT_OK;
  }
  return usageError(io, `unknown command: ${command}`);
}
