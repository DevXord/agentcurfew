import { parseArgs } from 'node:util';
import { getVersion } from '../version.ts';
import { EXIT_OK, EXIT_USAGE } from './io.ts';
import type { CliIo } from './io.ts';
import { printable } from './printable.ts';
import { runDoctorCommand } from './doctor.ts';
import { runExplain } from './explain.ts';
import { runInit } from './init.ts';
import { runLock } from './lock.ts';
import { runScan } from './scan.ts';
import { runVerify } from './verify.ts';

const HELP = `agentcurfew: inventory, lock and check what steers your AI coding agents.

Usage: agentcurfew <command> [options]
       acf <command> [options]

Commands:
  scan [directory]              Check what steers agents in a project against the rules
    --fail-on <level>           Exit with 1 at this level or above: critical, high (default), medium, low, none
    --inventory                 Only list the components, without the rules
    --json                      Print JSON; file contents and secrets are left out
    --user                      Also read your home directory and machine settings
  lock [directory]              Write agentcurfew.lock with a checksum of every component
  verify [directory]            Exit with 1 when a component changed since agentcurfew.lock
    --json                      Print JSON
  init [directory]              Write agentcurfew.policy.json from what the project has now
    --print                     Print the proposal instead of writing it
    --force                     Replace an existing policy
  doctor [directory]            Find configuration that agents ignore or that does not work
    --fail-on <level>           Exit with 1 at this level or above: error, warning (default), info, none
    --json                      Print JSON
  explain <rule>                Say what a rule finds, why it matters and how to fix it

Examples:
  agentcurfew scan
  agentcurfew scan --fail-on medium --json
  agentcurfew lock
  agentcurfew verify
  agentcurfew init --print
  agentcurfew doctor
  agentcurfew explain hidden-unicode

Options:
  -h, --help     Show this help
  -v, --version  Show the version

Planned command, not available yet: mcp
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
    const helped = argv.includes('--help') || argv.includes('-h');
    if (argv[0] === 'explain' && !helped) return runExplain(argv.slice(1), io, (what) => usageError(io, what));
    if (argv[0] === 'lock' && !helped) return runLock(argv.slice(1), io, (what) => usageError(io, what));
    if (argv[0] === 'verify' && !helped) return runVerify(argv.slice(1), io, (what) => usageError(io, what));
    if (argv[0] === 'init' && !helped) return runInit(argv.slice(1), io, (what) => usageError(io, what));
    if (argv[0] === 'doctor' && !helped) return runDoctorCommand(argv.slice(1), io, (what) => usageError(io, what));
    const parsed = parseGlobal(argv);
    const [command] = parsed.positionals;
    if (parsed.values.version === true && command === undefined) {
      io.stdout(`${getVersion()}\n`);
      return EXIT_OK;
    }
    if (command === undefined || command === 'help' || command === 'scan' || command === 'explain' || command === 'lock' || command === 'verify' || command === 'init' || command === 'doctor') {
      io.stdout(HELP);
      return EXIT_OK;
    }
    return usageError(io, `unknown command: ${command}`);
  } catch (error) {
    if (isParseError(error)) return usageError(io, error.message.split('\n')[0] ?? 'invalid arguments');
    throw error;
  }
}
