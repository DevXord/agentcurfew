export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

import type { Readable, Writable } from 'node:stream';

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  /** Whether labels on stdout may be colored; false or absent prints plain text. */
  color?: boolean;
  /** The whole of stdin, for commands that read it (hook); absent reads nothing. */
  stdin?: () => Promise<string>;
  /** Raw streams for a command that keeps talking (mcp); absent, such a command cannot run. */
  streams?: { input: Readable; output: Writable };
}
