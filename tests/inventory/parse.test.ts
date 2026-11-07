import { describe, expect, it } from 'vitest';
import { entryText, lookup, parseConfig, stripJsonc } from '../../src/inventory/parse.ts';

describe('stripJsonc', () => {
  it('removes comments and trailing commas', () => {
    expect(JSON.parse(stripJsonc('{ // a\n "a": [1, 2,], /* b */ "c": 3, }'))).toEqual({ a: [1, 2], c: 3 });
  });

  it('keeps what only looks like a comment or a trailing comma inside a string', () => {
    const text = '{"url":"https://x.test/*y*/","q":"a\\"//b","c":",}"}';
    expect(JSON.parse(stripJsonc(text))).toEqual(JSON.parse(text));
  });

  it('keeps a comma before a comment and a following value', () => {
    expect(JSON.parse(stripJsonc('[1, /* x */ 2]'))).toEqual([1, 2]);
  });

  it('leaves a broken file broken', () => {
    expect(parseConfig('{"a":', 'json')).toBeUndefined();
    expect(parseConfig('{"a": "unterminated', 'json')).toBeUndefined();
    expect(parseConfig('{"a": /* open', 'json')).toBeUndefined();
  });
});

describe('parseConfig', () => {
  it('reads a file with a byte order mark', () => {
    expect(parseConfig('\uFEFF{"a":1}', 'json')).toEqual({ a: 1 });
    expect(parseConfig('\uFEFFa = 1\n', 'toml')).toMatchObject({ a: 1 });
  });

  it('refuses nesting that later steps could not walk', () => {
    expect(parseConfig(`{"a":${'['.repeat(100)}${']'.repeat(100)}}`, 'json')).toBeUndefined();
    expect(parseConfig(`a = ${'['.repeat(100)}${']'.repeat(100)}\n`, 'toml')).toBeUndefined();
  });

  it('keeps an integer TOML allows but a number cannot hold, so the file stays in the inventory', () => {
    const value = parseConfig('a = 9223372036854775807\n', 'toml');
    expect(entryText(value)).toContain('9223372036854775807');
  });

  it('does not change prototypes', () => {
    parseConfig('{"__proto__":{"polluted":true}}', 'json');
    parseConfig('[__proto__]\npolluted = true\n', 'toml');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe('lookup', () => {
  it('follows nested keys and keys written with dots', () => {
    expect(lookup({ a: { b: 1 } }, 'a.b')).toEqual([{ path: 'a.b', value: 1 }]);
    expect(lookup({ 'a.b': 2 }, 'a.b')).toEqual([{ path: 'a.b', value: 2 }]);
    expect(lookup({ 'a.b': { c: 3 } }, 'a.b.c')).toEqual([{ path: 'a.b.c', value: 3 }]);
  });

  it('takes * and <name> for any key', () => {
    const value = { s: { one: { t: 1 }, two: { t: 2 }, three: {} } };
    expect(lookup(value, 's.*.t').map((m) => m.path)).toEqual(['s.one.t', 's.two.t']);
    expect(lookup(value, 's.<id>.t').map((m) => m.value)).toEqual([1, 2]);
  });

  it('reads only own keys', () => {
    expect(lookup({}, 'constructor')).toEqual([]);
    expect(lookup({}, '__proto__')).toEqual([]);
    expect(lookup(null, 'a')).toEqual([]);
  });
});
