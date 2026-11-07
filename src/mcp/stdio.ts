import type { Readable, Writable } from 'node:stream';
import { McpServer } from './protocol.ts';

/** The longest message read; a longer line is answered with a parse error and dropped. */
export const MAX_LINE_BYTES = 1024 * 1024;

/**
 * Serves MCP over a pair of streams, one JSON-RPC message per line. Only MCP messages go to `output`; the promise
 * resolves when `input` ends, which is how a client stops a stdio server.
 */
export function serveStdio(input: Readable, output: Writable, options: { root: string; roots?: readonly string[] }): Promise<void> {
  const server = new McpServer({ ...options, send: (message) => output.write(`${JSON.stringify(message)}\n`) });
  let buffer = '';
  let dropping = false;
  return new Promise((resolve) => {
    input.setEncoding('utf8');
    input.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        // Each whole line is held to the limit too, also one that arrived complete within a chunk.
        if (dropping) dropping = false;
        else if (Buffer.byteLength(line) > MAX_LINE_BYTES) server.receiveLine('{');
        else server.receiveLine(line);
        newline = buffer.indexOf('\n');
      }
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
        if (!dropping) server.receiveLine('{');
        buffer = '';
        dropping = true;
      }
    });
    input.on('end', () => {
      if (!dropping && buffer.trim() !== '') server.receiveLine(buffer);
      resolve();
    });
    input.on('error', () => resolve());
  });
}
