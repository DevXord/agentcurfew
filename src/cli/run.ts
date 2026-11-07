import { closest } from '../text/distance.ts';
import { getVersion } from '../version.ts';
import { COMMANDS, commandHelpText, findCommand, helpText, welcomeText } from './commands.ts';
import { runDoctorCommand } from './doctor.ts';
import { runExplain } from './explain.ts';
import { runHookCommand } from './hook.ts';
import { runMcp } from './mcp.ts';
import { runInit } from './init.ts';
import { EXIT_OK, EXIT_USAGE } from './io.ts';
import type { CliIo } from './io.ts';
import { runLock } from './lock.ts';
import { printable } from './printable.ts';
import { runScan } from './scan.ts';
import { runVerify } from './verify.ts';

type Handler = (argv: readonly string[], io: CliIo, usageError: (what: string) => number) => number | Promise<number>;

const HANDLERS: Readonly<Record<string, Handler>> = {
  scan: runScan,
  lock: runLock,
  verify: runVerify,
  init: runInit,
  doctor: runDoctorCommand,
  explain: runExplain,
  hook: runHookCommand,
  mcp: runMcp,
};

function usageError(io: CliIo, what: string, command?: string, suggestion?: string): number {
  const hint = suggestion === undefined ? '' : `did you mean ${suggestion}? `;
  const fix = command === undefined ? 'run agentcurfew help to see what is available' : `run agentcurfew help ${command} to see its options`;
  io.stderr(`agentcurfew: ${printable(what)}\n  in: the command line\n  fix: ${hint}${fix}\n`);
  return EXIT_USAGE;
}

function isParseError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS_');
}

/** A parseArgs error in one line, with the closest option of the command when the option is unknown. */
function parseError(io: CliIo, error: Error & { code: string }, command: string): number {
  const first = error.message.split('\n')[0] ?? 'invalid arguments';
  const unknown = /^Unknown option '(-{1,2}[^']*)'/.exec(first)?.[1];
  if (unknown !== undefined) {
    const options = (findCommand(command)?.options ?? []).map((option) => `--${option.name}`);
    return usageError(io, `unknown option for ${command}: ${unknown}`, command, closest(unknown, [...options, '--help']));
  }
  return usageError(io, first.replace(/\. To specify a positional argument.*$/, ''), command);
}

export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  const [first, ...rest] = argv;
  if (first === undefined) {
    io.stdout(welcomeText());
    return EXIT_OK;
  }
  if (first === '--version' || first === '-v') {
    io.stdout(`${getVersion()}\n`);
    return EXIT_OK;
  }
  if (first === '--help' || first === '-h') {
    // -h scan shows the help of scan, as help scan does.
    const named = rest[0] === undefined ? undefined : findCommand(rest[0]);
    io.stdout(named === undefined ? helpText() : commandHelpText(named));
    return EXIT_OK;
  }
  if (first === 'help') {
    if (rest.includes('--help') || rest.includes('-h')) {
      io.stdout(commandHelpText(findCommand('help') as NonNullable<ReturnType<typeof findCommand>>));
      return EXIT_OK;
    }
    const target = rest[0];
    if (target === undefined) {
      io.stdout(helpText());
      return EXIT_OK;
    }
    const spec = findCommand(target);
    if (spec === undefined || rest.length > 1) return usageError(io, `no such command: ${target}`, undefined, closest(target, COMMANDS.map((command) => command.name)));
    io.stdout(commandHelpText(spec));
    return EXIT_OK;
  }
  const spec = findCommand(first);
  const handler = HANDLERS[first];
  if (spec === undefined || handler === undefined) {
    if (first.startsWith('-')) return usageError(io, `unknown option: ${first}`, undefined, closest(first, ['--help', '--version']));
    return usageError(io, `unknown command: ${first}`, undefined, closest(first, COMMANDS.map((command) => command.name)));
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    io.stdout(commandHelpText(spec));
    return EXIT_OK;
  }
  try {
    return await handler(rest, io, (what) => usageError(io, what, first));
  } catch (error) {
    if (isParseError(error)) return parseError(io, error, first);
    throw error;
  }
}
