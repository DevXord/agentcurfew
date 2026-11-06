import fc from 'fast-check';
import { describe, it } from 'vitest';
import { parseFrontmatter } from '../../src/inventory/frontmatter.ts';
import type { Component } from '../../src/inventory/index.ts';
import { entryText, lookup, parseConfig, stripJsonc } from '../../src/inventory/parse.ts';
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
