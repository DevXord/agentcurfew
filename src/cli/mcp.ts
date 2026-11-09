import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { serveStdio } from '../mcp/stdio.ts';
import { parseCommand } from './commands.ts';
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from './io.ts';
import type { CliIo } from './io.ts';
import { printable } from './printable.ts';

/** agentcurfew mcp: serves until stdin closes. Writes nothing but MCP messages to stdout. */
export async function runMcp(argv: readonly string[], io: CliIo, usageError: (what: string) => number): Promise<number> {
  const { values, positionals } = parseCommand('mcp', argv);
  if (positionals.length > 0) return usageError(`mcp takes no directory; it serves the folder it is started in, and --root adds others`);
  const roots: string[] = [];
  for (const given of (values.root as string[] | undefined) ?? []) {
    try {
      if (!statSync(given).isDirectory()) throw new Error('not a directory');
      roots.push(realpathSync.native(resolve(given)));
    } catch {
      io.stderr(`agentcurfew: not a directory: ${printable(given)}\n  in: --root\n  fix: pass a folder that exists\n`);
      return EXIT_USAGE;
    }
  }
  if (io.streams === undefined) {
    io.stderr('agentcurfew: mcp needs stdin and stdout\n  in: the command line\n  fix: start it as an MCP server from your agent\'s settings, as docs/mcp.md shows\n');
    return EXIT_FAILURE;
  }
  await serveStdio(io.streams.input, io.streams.output, { root: realpathSync.native(process.cwd()), roots });
  return EXIT_OK;
}
