import { fileURLToPath } from 'node:url';
import { deeperThan } from '../inventory/parse.ts';
import { getVersion } from '../version.ts';
import { callTool, TOOLS } from './tools.ts';

// MCP over JSON-RPC 2.0, in both eras of the specification (D-025):
// 2026-07-28 (https://modelcontextprotocol.io/specification/2026-07-28): no initialize; every request carries its version
// and capabilities in _meta, server/discover is required, results carry resultType.
// 2025-11-25 (https://modelcontextprotocol.io/specification/2025-11-25): initialize, notifications/initialized, ping,
// and roots/list for clients with the roots capability.
export const MODERN_VERSIONS = ['2026-07-28'] as const;
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18'] as const;
const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const UNSUPPORTED_PROTOCOL_VERSION = -32022;

const INSTRUCTIONS =
  'agentcurfew checks what steers AI coding agents without running any of it. Before installing a skill, call check_skill on its folder; before adding an MCP server, call check_mcp_config with its definition; scan_project checks a whole project; explain_rule explains a finding.';

type Id = string | number;
type Message = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rpcError(id: Id | null, code: number, message: string, data?: unknown): Message {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

function rpcResult(id: Id, result: unknown): Message {
  return { jsonrpc: '2.0', id, result };
}

export interface ServerOptions {
  root: string;
  /** Further folders the tools may read, given with --root. */
  roots?: readonly string[];
  send: (message: Message) => void;
  now?: Date;
}

/** An MCP server for one connection: messages in through receive, out through send. Nothing it finds is run. */
export class McpServer {
  readonly #options: ServerOptions;
  #legacyVersion: string | undefined;
  #clientRoots: string[] = [];
  #clientHasRoots = false;
  #nextId = 0;
  readonly #pending = new Map<Id, (result: unknown) => void>();

  constructor(options: ServerOptions) {
    this.#options = options;
  }

  #allowed(): string[] {
    return [this.#options.root, ...(this.#options.roots ?? []), ...this.#clientRoots];
  }

  #requestRoots(): void {
    const id = `agentcurfew-roots-${this.#nextId++}`;
    this.#pending.set(id, (result) => {
      const roots = isRecord(result) && Array.isArray(result.roots) ? result.roots : [];
      this.#clientRoots = roots.flatMap((root: unknown) => {
        if (!isRecord(root) || typeof root.uri !== 'string' || !root.uri.startsWith('file://')) return [];
        try {
          return [fileURLToPath(root.uri)];
        } catch {
          return [];
        }
      });
    });
    this.#options.send({ jsonrpc: '2.0', id, method: 'roots/list' });
  }

  /** One message from the client, already parsed; a line that is not JSON goes to receiveLine. */
  receive(message: unknown): void {
    if (Array.isArray(message)) return this.#options.send(rpcError(null, INVALID_REQUEST, 'batches are not supported'));
    if (!isRecord(message) || message.jsonrpc !== '2.0') return this.#options.send(rpcError(null, INVALID_REQUEST, 'not a JSON-RPC 2.0 message'));
    const id = message.id;
    const hasId = typeof id === 'string' || typeof id === 'number';
    if (typeof message.method !== 'string') {
      // A response to a request of the server.
      if (hasId && this.#pending.has(id)) {
        const resolve = this.#pending.get(id);
        this.#pending.delete(id);
        resolve?.(message.result);
      }
      return;
    }
    const params = isRecord(message.params) ? message.params : {};
    if (!hasId) return this.#notification(message.method);
    try {
      this.#options.send(this.#request(id, message.method, params));
    } catch {
      this.#options.send(rpcError(id, -32603, 'internal error'));
    }
  }

  /** One line of the stdio transport. */
  receiveLine(line: string): void {
    if (line.trim() === '') return;
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      return this.#options.send(rpcError(null, PARSE_ERROR, 'the message is not valid JSON'));
    }
    if (deeperThan(message, 64)) return this.#options.send(rpcError(null, INVALID_REQUEST, 'the message is nested too deeply'));
    this.receive(message);
  }

  #notification(method: string): void {
    if (method === 'notifications/initialized' && this.#clientHasRoots) this.#requestRoots();
    if (method === 'notifications/roots/list_changed' && this.#clientHasRoots) this.#requestRoots();
  }

  /** The era of a request: legacy after initialize, otherwise the version in _meta, which must be supported. */
  #era(id: Id, params: Record<string, unknown>): { modern: boolean } | Message {
    if (this.#legacyVersion !== undefined) return { modern: false };
    const meta = isRecord(params._meta) ? params._meta : {};
    const requested = meta[VERSION_KEY];
    if (typeof requested !== 'string') return rpcError(id, INVALID_PARAMS, `no ${VERSION_KEY} in _meta, and no initialize before`);
    if (!(MODERN_VERSIONS as readonly string[]).includes(requested)) {
      return rpcError(id, UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', { supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], requested });
    }
    return { modern: true };
  }

  #request(id: Id, method: string, params: Record<string, unknown>): Message {
    const serverInfo = { name: 'agentcurfew', version: getVersion() };
    if (method === 'initialize') {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      this.#legacyVersion = (LEGACY_VERSIONS as readonly string[]).includes(requested) ? requested : LEGACY_VERSIONS[0];
      const capabilities = isRecord(params.capabilities) ? params.capabilities : {};
      this.#clientHasRoots = isRecord(capabilities.roots);
      return rpcResult(id, { protocolVersion: this.#legacyVersion, capabilities: { tools: {} }, serverInfo, instructions: INSTRUCTIONS });
    }
    if (method === 'server/discover') {
      return rpcResult(id, { resultType: 'complete', supportedVersions: [...MODERN_VERSIONS], capabilities: { tools: {} }, instructions: INSTRUCTIONS, ttlMs: 3_600_000, cacheScope: 'public', _meta: { [SERVER_INFO_KEY]: serverInfo } });
    }
    if (method === 'ping') return rpcResult(id, {});
    const era = this.#era(id, params);
    if ('jsonrpc' in era) return era;
    const extra = era.modern ? { resultType: 'complete' } : {};
    if (method === 'tools/list') {
      const cache = era.modern ? { ttlMs: 3_600_000, cacheScope: 'public' } : {};
      return rpcResult(id, { tools: TOOLS, ...cache, ...extra });
    }
    if (method === 'tools/call') {
      const name = params.name;
      if (typeof name !== 'string' || !TOOLS.some((tool) => tool.name === name)) return rpcError(id, INVALID_PARAMS, 'unknown tool');
      const args = isRecord(params.arguments) ? params.arguments : {};
      const result = callTool(name, args, { root: this.#options.root, allowed: () => this.#allowed(), ...(this.#options.now === undefined ? {} : { now: this.#options.now }) });
      return rpcResult(id, { ...result, ...extra });
    }
    return rpcError(id, METHOD_NOT_FOUND, 'method not found');
  }
}
