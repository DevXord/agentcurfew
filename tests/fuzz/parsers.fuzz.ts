import fc from 'fast-check';
import { describe, it } from 'vitest';
import { parseFrontmatter } from '../../src/inventory/frontmatter.ts';
import type { Component } from '../../src/inventory/index.ts';
import { entryText, lookup, parseConfig, stripJsonc } from '../../src/inventory/parse.ts';
import { diffLocks } from '../../src/lock/diff.ts';
import { parseLock } from '../../src/lock/read.ts';
import { redact } from '../../src/lock/redact.ts';
import { runHook } from '../../src/hook/index.ts';
import { McpServer } from '../../src/mcp/protocol.ts';
import { validatePolicy } from '../../src/policy/validate.ts';
import { runRules } from '../../src/rules/index.ts';

const text = fc.oneof(fc.string({ unit: 'binary' }), fc.json(), fc.stringMatching(/^[[\]{}",:=/*\\\n a.#'-]{0,60}$/));

describe('parsers', () => {
  it('never throw on any file', () => {
    fc.assert(
      fc.property(text, fc.constantFrom('json', 'toml') as fc.Arbitrary<'json' | 'toml'>, (input, format) => {
        const value = parseConfig(input, format);
        entryText(value);
        lookup(value, 'mcpServers.*.command');
      }),
      { numRuns: 5000 },
    );
  });

  it('leave valid JSON as it is', () => {
    fc.assert(
      fc.property(fc.json(), (input) => {
        const stripped = JSON.stringify(JSON.parse(stripJsonc(input)));
        return stripped === JSON.stringify(JSON.parse(input));
      }),
      { numRuns: 5000 },
    );
  });
});

describe('frontmatter and rules', () => {
  const markdown = fc.oneof(
    fc.string({ unit: 'binary' }),
    fc.string({ unit: 'binary' }).map((body) => `---\n${body}\n---\n`),
    fc.stringMatching(/^[\-:\n &*![\]{}a-z#|>'"]{0,80}$/).map((body) => `---\n${body}\n---\nbody`),
  );

  it('never throw on any file', () => {
    fc.assert(
      fc.property(markdown, fc.constantFrom('skill', 'context-file', 'hook', 'mcp-server', 'auto-run', 'permission', 'subagent', 'command'), (raw, kind) => {
        parseFrontmatter(raw);
        const component = { kind, agents: ['claude-code', 'cline', 'codex', 'cursor', 'gemini-cli'], scope: 'project', file: 'x/y.md', name: kind === 'skill' ? 'y' : 'n', raw } as Component;
        for (const finding of runRules({ components: [component], problems: [] })) {
          if (finding.message.includes('the rule failed')) throw new Error(`${finding.rule} threw`);
          if (/\p{C}/u.test(finding.message)) throw new Error(`${finding.rule} printed a hidden character`);
        }
      }),
      { numRuns: 3000 },
    );
  });
});

describe('lock', () => {
  it('reads any JSON as a lock or a reason, and redacts without throwing', () => {
    fc.assert(
      fc.property(fc.oneof(fc.json(), fc.constant('{"lockfileVersion":1,"algorithm":"sha256","components":[]}')), fc.string({ unit: 'binary' }), (json, word) => {
        const parsed = parseLock(JSON.parse(json));
        if ('lock' in parsed) diffLocks(parsed.lock, parsed.lock);
        redact(word);
      }),
      { numRuns: 3000 },
    );
  });
});

describe('policy', () => {
  it('validates any JSON without throwing, and accepts only objects of version 1', () => {
    fc.assert(
      fc.property(fc.oneof(fc.json(), fc.json().map((inner) => `{"version":1,"mcp":${inner}}`)), (json) => {
        const value: unknown = JSON.parse(json);
        const result = validatePolicy(value);
        if (result.issues.length === 0 && (typeof value !== 'object' || value === null || (value as { version?: unknown }).version !== 1)) throw new Error('accepted a policy without version 1');
      }),
      { numRuns: 3000 },
    );
  });
});

describe('MCP server and hook', () => {
  it('answer any line and any hook input without throwing', () => {
    const line = fc.oneof(fc.string({ unit: 'binary' }), fc.json(), fc.json().map((params) => `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":${params}}`));
    fc.assert(
      fc.property(line, (text) => {
        const sent: unknown[] = [];
        const server = new McpServer({ root: process.cwd(), send: (message) => sent.push(message) });
        server.receiveLine(text);
        for (const message of sent) JSON.stringify(message);
        const result = runHook(text, {}, process.cwd());
        if (result.stdout !== '' && !result.stdout.includes('"hookEventName":"PreToolUse"')) throw new Error('hook printed something that is not a decision');
        if (result.stdout.includes('"allow"')) throw new Error('hook allowed');
      }),
      { numRuns: 1500 },
    );
  });
});
