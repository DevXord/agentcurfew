import { quote } from '../mask.ts';
import { mcpEntry } from '../mcp.ts';
import type { Rule } from '../types.ts';

function isLocal(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  return bare === 'localhost' || bare.endsWith('.localhost') || bare === '::1' || /^127(?:\.\d{1,3}){3}$/.test(bare) || bare === '0.0.0.0';
}

export const plainHttpMcp: Rule = {
  id: 'plain-http-mcp',
  title: 'Remote MCP server without encryption',
  level: 'high',
  owasp: ['AST02'],
  description:
    'Finds remote MCP servers reached over http:// or ws:// on a host other than this machine. Anyone on the network path can read the traffic, including tokens in headers, and change the tool descriptions and results the agent receives.',
  fix: 'Use the https:// (or wss://) address of the server. If it has none, run it locally or behind a TLS proxy.',
  example: '"url": "http://mcp.example.com/sse"',
  kinds: ['mcp-server'],
  check(component, context) {
    const entry = mcpEntry(component, context.knowledge);
    if (entry === undefined) return [];
    return entry.urls.flatMap((url) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return [];
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'ws:') return [];
      if (isLocal(parsed.hostname)) return [];
      return [{ message: `connects to ${quote(`${parsed.protocol}//${parsed.host}`, 80)} without TLS` }];
    });
  },
};
