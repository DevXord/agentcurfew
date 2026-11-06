import { parseArgs } from 'node:util';
import { getVersion } from '../version.ts';
import { EXIT_OK, EXIT_USAGE } from './io.ts';
import type { CliIo } from './io.ts';
import { printable } from './printable.ts';
import { runScan } from './scan.ts';

const HELP = `agentcurfew: inventory, lock and check what steers your AI coding agents.

Usage: agentcurfew <command> [options]
       acf <command> [options]

Commands:
  scan [directory] --inventory  List what steers agents in a project
    --json                      Print JSON; file contents are left out
    --user                      Also read your home directory and machine settings

Options:
  -h, --help     Show this help
  -v, --version  Show the version

Planned commands, not available yet: lock, verify, init, doctor, explain, mcp
`;

function usageError(io: CliIo, what: string): number {
  io.stderr(`agentcurfew: ${printable(what)}\n  in: the command line\n  fix: run agentcurfew --help to see what is available\n`);
  return EXIT_USAGE;
}

function isParseError(error: unknown): error is Error {
  return error instanceof Error && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS_');
}

function parseGlobal(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
}

export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    if (argv[0] === 'scan' && !argv.includes('--help') && !argv.includes('-h')) {
      return runScan(argv.slice(1), io, (what) => usageError(io, what));
    }
    const parsed = parseGlobal(argv);
    const [command] = parsed.positionals;
    if (parsed.values.version === true && command === undefined) {
      io.stdout(`${getVersion()}\n`);
      return EXIT_OK;
    }
    if (command === undefined || command === 'help' || command === 'scan') {
      io.stdout(HELP);
      return EXIT_OK;
    }
    return usageError(io, `unknown command: ${command}`);
  } catch (error) {
    if (isParseError(error)) return usageError(io, error.message.split('\n')[0] ?? 'invalid arguments');
    throw error;
  }
}
