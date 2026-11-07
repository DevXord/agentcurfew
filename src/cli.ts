#!/usr/bin/env node
import { EXIT_FAILURE } from './cli/io.ts';

// A reader that went away (agentcurfew --help | head -1) must not end in a stack trace from an unhandled EPIPE.
function quietWhenClosed(stream: NodeJS.WriteStream): (text: string) => void {
  let closed = false;
  stream.on('error', (error: NodeJS.ErrnoException) => {
    closed = true;
    if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') return;
    if (stream !== process.stderr) process.stderr.write(`agentcurfew: cannot write the output: ${error.message}\n`);
    process.exitCode = EXIT_FAILURE;
  });
  return (text) => {
    if (!closed) stream.write(text);
  };
}

// Node warns on stderr while loading node:util when FORCE_COLOR and NO_COLOR are both set, and stderr must stay empty
// with --json. The warning can arrive before this module runs if node:util is a static import, so run.ts loads later.
function dropColorWarning(): void {
  const printers = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (warning) => {
    if (warning.name === 'Warning' && warning.message.includes("'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env")) return;
    for (const print of printers) print(warning);
  });
}

dropColorWarning();
// The whole of stdin, read only by the commands that ask for it, and only up to a limit: more is a sign of the wrong input.
function readStdin(): Promise<string> {
  const limit = 8 * 1024 * 1024;
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    process.stdin.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    process.stdin.on('end', () => resolve(size > limit ? 'x'.repeat(limit + 1) : Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

Promise.all([import('./cli/run.ts'), import('./cli/style.ts')])
  .then(([{ run }, { wantsColor }]) =>
    run(process.argv.slice(2), {
      stdout: quietWhenClosed(process.stdout),
      stderr: quietWhenClosed(process.stderr),
      color: wantsColor(process.stdout.isTTY, process.env),
      stdin: readStdin,
      streams: { input: process.stdin, output: process.stdout },
    }),
  )
  .then(
    (code) => {
      if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`agentcurfew: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = EXIT_FAILURE;
    },
  );
