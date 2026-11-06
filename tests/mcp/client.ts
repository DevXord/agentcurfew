import type { Transport } from '@modelcontextprotocol/client';
import { McpServer } from '../../src/mcp/protocol.ts';

/** Joins the official MCP client to our server core in memory, the way a stdio pipe would, message by message. */
export class ServerTransport implements Transport {
  onmessage?: Transport['onmessage'];
  onclose?: () => void;
  onerror?: (error: Error) => void;
  readonly sent: unknown[] = [];
  readonly server: McpServer;

  constructor(options: { root: string; roots?: readonly string[] }) {
    this.server = new McpServer({
      ...options,
      send: (message) => {
        this.sent.push(message);
        // A copy, as a pipe would carry it, delivered after the current call like a real transport.
        const copy = JSON.parse(JSON.stringify(message)) as Parameters<NonNullable<Transport['onmessage']>>[0];
        queueMicrotask(() => this.onmessage?.(copy));
      },
    });
  }

  async start(): Promise<void> {}

  async send(message: unknown): Promise<void> {
    this.server.receive(JSON.parse(JSON.stringify(message)) as unknown);
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}
