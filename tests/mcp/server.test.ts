import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '../../src/mcp/protocol.ts';
import { serveStdio } from '../../src/mcp/stdio.ts';
import { materialize } from '../rules/materialize.ts';
import { ServerTransport } from './client.ts';

let base: string;
let root: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'acf-mcp-'));
  root = join(base, 'project');
  mkdirSync(root);
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

async function connect(mode: 'legacy' | 'auto', extra: { roots?: string[] } = {}) {
  const transport = new ServerTransport({ root, ...extra });
  const client = new Client({ name: 'test', version: '1.0.0' }, { versionNegotiation: { mode } });
  await client.connect(transport);
  return { client, transport };
}

const text = (result: { content: unknown }) => (result.content as { type: string; text: string }[]).map((part) => part.text).join('\n');

describe('MCP server with the official client', () => {
  it.each(['legacy', 'auto'] as const)('negotiates and lists read-only tools (%s)', async (mode) => {
    const { client } = await connect(mode);
    expect(client.getNegotiatedProtocolVersion()).toBe(mode === 'auto' ? '2026-07-28' : '2025-11-25');
    expect(client.getServerVersion()?.name).toBe('agentcurfew');
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['scan_project', 'check_skill', 'check_mcp_config', 'explain_rule']);
    for (const tool of tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    await client.close();
  });

  it.each(['legacy', 'auto'] as const)('scans a project (%s)', async (mode) => {
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { web: { type: 'http', url: 'http://mcp.example.com/mcp' } } }));
    const { client } = await connect(mode);
    const result = await client.callTool({ name: 'scan_project', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('HIGH plain-http-mcp .mcp.json (web)');
    expect((result.structuredContent as { findings: { rule: string }[] }).findings.map((finding) => finding.rule)).toContain('plain-http-mcp');
    await client.close();
  });

  it('checks a skill folder before it is installed', async () => {
    const { root: fixture, cleanup } = materialize('remote-instructions/positive');
    try {
      const skill = join(fixture, '.claude/skills/updater');
      const transport = new ServerTransport({ root, roots: [fixture] });
      const client = new Client({ name: 'test', version: '1.0.0' });
      await client.connect(transport);
      const result = await client.callTool({ name: 'check_skill', arguments: { path: skill } });
      expect(text(result)).toContain('remote-instructions');
      await client.close();
    } finally {
      cleanup();
    }
  });

  it('checks an MCP definition, masks secrets and applies the policy', async () => {
    writeFileSync(join(root, 'agentcurfew.policy.json'), JSON.stringify({ version: 1, mcp: { allowServers: ['@modelcontextprotocol/*'] } }));
    const { client } = await connect('auto');
    const token = `ghp${'_'}${'Ab1'.repeat(12)}`;
    const result = await client.callTool({ name: 'check_mcp_config', arguments: { config: { command: 'npx', args: ['-y', 'random-server'], env: { GITHUB_TOKEN: token } }, name: 'random' } });
    const output = text(result);
    expect(output).toContain('unpinned-mcp-server');
    expect(output).toContain('secret-in-config');
    expect(output).toContain('out-of-policy');
    expect(JSON.stringify(result)).not.toContain('Ab1Ab1');
    const map = await client.callTool({ name: 'check_mcp_config', arguments: { config: { mcpServers: { fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2026.1.14'] } } } } });
    expect(text(map)).toBe('MCP configuration: 0 findings');
    await client.close();
  });

  it('explains a rule and suggests one for a typo', async () => {
    const { client } = await connect('legacy');
    expect(text(await client.callTool({ name: 'explain_rule', arguments: { id: 'hidden-unicode' } }))).toContain('hidden-unicode: Hidden Unicode characters');
    const typo = await client.callTool({ name: 'explain_rule', arguments: { id: 'hiden-unicode' } });
    expect(typo.isError).toBe(true);
    expect(text(typo)).toContain('did you mean hidden-unicode?');
    await client.close();
  });

  it('refuses paths outside its folders, also through a link', async () => {
    const outside = join(base, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(root, 'link'));
    const { client } = await connect('auto');
    for (const path of [outside, join(root, 'link'), '../outside']) {
      const result = await client.callTool({ name: 'scan_project', arguments: { path } });
      expect(result.isError, path).toBe(true);
      expect(text(result)).toContain('outside the folders this server may read');
    }
    await client.close();
  });
});

describe('MCP protocol details', () => {
  function raw() {
    const sent: Record<string, unknown>[] = [];
    const server = new McpServer({ root, send: (message) => sent.push(message) });
    return { server, sent };
  }

  it('answers bad input with JSON-RPC errors and no text from the input', () => {
    const { server, sent } = raw();
    server.receiveLine('not json \u001b[31m');
    server.receiveLine('[1]');
    server.receiveLine('{"jsonrpc":"1.0","id":1,"method":"x"}');
    server.receiveLine(`${'['.repeat(100)}${']'.repeat(100)}`);
    server.receiveLine('{"jsonrpc":"2.0","id":2,"method":"no/such","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}');
    expect(sent.map((message) => (message.error as { code: number }).code)).toEqual([-32700, -32600, -32600, -32600, -32601]);
    expect(JSON.stringify(sent)).not.toContain('\u001b');
  });

  it('rejects an unsupported version with the list of supported ones', () => {
    const { server, sent } = raw();
    server.receive({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01', 'io.modelcontextprotocol/clientCapabilities': {} } } });
    expect(sent[0]).toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2026-07-28', '2025-11-25', '2025-06-18'], requested: '1900-01-01' } } });
  });

  it('answers server/discover as the 2026-07-28 example does', () => {
    const { server, sent } = raw();
    server.receive({ jsonrpc: '2.0', id: 'd', method: 'server/discover', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } });
    expect(sent[0]).toMatchObject({ id: 'd', result: { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, cacheScope: 'public', _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'agentcurfew' } } } });
  });

  it('negotiates the legacy version and asks for roots', () => {
    const { server, sent } = raw();
    server.receive({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: { roots: {} }, clientInfo: { name: 'c', version: '1' } } });
    expect((sent[0]?.result as { protocolVersion: string }).protocolVersion).toBe('2025-11-25');
    server.receive({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const request = sent[1] as { id: string; method: string };
    expect(request.method).toBe('roots/list');
    const extra = join(base, 'extra');
    mkdirSync(extra);
    server.receive({ jsonrpc: '2.0', id: request.id, result: { roots: [{ uri: pathToFileURL(extra).href }] } });
    server.receive({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'scan_project', arguments: { path: extra } } });
    expect((sent[2]?.result as { isError?: boolean }).isError).toBeUndefined();
    server.receive({ jsonrpc: '2.0', id: 3, method: 'ping' });
    expect(sent[3]).toEqual({ jsonrpc: '2.0', id: 3, result: {} });
  });

  it('serves over stdio streams and stops when input ends', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    output.on('data', (chunk: Buffer) => lines.push(...chunk.toString('utf8').split('\n').filter(Boolean)));
    const done = serveStdio(input, output, { root });
    input.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{}}}\r\n');
    input.write(`{"jsonrpc":"2.0","id":2,"method":"ping"}\n${'x'.repeat(1024 * 1024 + 10)}`);
    input.write('\n{"jsonrpc":"2.0","id":3,"method":"ping"}\n');
    input.end();
    await done;
    const messages = lines.map((line) => JSON.parse(line) as { id: unknown; error?: { code: number } });
    expect(messages.map((message) => message.id)).toEqual([1, 2, null, 3]);
    expect(messages[2]?.error?.code).toBe(-32700);
  });
});
