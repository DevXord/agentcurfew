import fc from 'fast-check';
import { describe, it } from 'vitest';
import { entryText, lookup, parseConfig, stripJsonc } from '../../src/inventory/parse.ts';

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
