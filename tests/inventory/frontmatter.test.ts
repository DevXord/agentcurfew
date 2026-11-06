import { describe, expect, it } from 'vitest';
import { frontmatterText, parseFrontmatter } from '../../src/inventory/frontmatter.ts';

const wrap = (yaml: string) => `---\n${yaml}\n---\nBody\n`;

describe('frontmatter', () => {
  it('finds the block between the first two --- lines', () => {
    expect(frontmatterText('---\na: 1\n---\nrest')).toEqual({ yaml: 'a: 1\n', line: 2 });
    expect(frontmatterText('\uFEFF---\r\na: 1\r\n...\r\n')).toEqual({ yaml: 'a: 1\r\n', line: 2 });
    expect(frontmatterText('no frontmatter')).toBeUndefined();
    expect(frontmatterText('---\nnever closed')).toBeUndefined();
    expect(parseFrontmatter('text')).toEqual({ status: 'none' });
  });

  it('parses ordinary YAML', () => {
    expect(parseFrontmatter(wrap('name: x\nallowed-tools:\n  - Read\n  - Bash(git *)'))).toEqual({ status: 'ok', value: { name: 'x', 'allowed-tools': ['Read', 'Bash(git *)'] }, line: 2 });
  });

  // D-012: hostile input must fail fast and safely.
  it('rejects an alias bomb quickly', () => {
    let yaml = 'a: &a [x, x, x, x, x, x, x, x, x]\n';
    for (let level = 0; level < 9; level++) {
      const from = String.fromCharCode(97 + level);
      const to = String.fromCharCode(98 + level);
      yaml += `${to}: &${to} [${Array(9).fill(`*${from}`).join(', ')}]\n`;
    }
    const start = performance.now();
    expect(parseFrontmatter(wrap(yaml)).status).toBe('unparsable');
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('keeps __proto__ as data and pollutes nothing', () => {
    const parsed = parseFrontmatter(wrap('__proto__: {polluted: true}\nconstructor: {prototype: {polluted: true}}'));
    expect(parsed.status).toBe('ok');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.hasOwn((parsed as { value: object }).value, '__proto__')).toBe(true);
  });

  it('rejects deep nesting, duplicate keys and oversized blocks', () => {
    expect(parseFrontmatter(wrap(`${'['.repeat(2000)}${']'.repeat(2000)}`)).status).toBe('unparsable');
    expect(parseFrontmatter(wrap(Array.from({ length: 80 }, (_, i) => `${' '.repeat(i)}k:`).join('\n'))).status).toBe('unparsable');
    expect(parseFrontmatter(wrap('a: 1\na: 2')).status).toBe('unparsable');
    expect(parseFrontmatter(wrap(`a: "${'x'.repeat(40_000)}"`)).status).toBe('too-large');
  });

  it('reads tags and merge keys as plain data', () => {
    expect(parseFrontmatter(wrap('a: !!js/function "f"\nb: !custom value\nc: &c {x: 1}\nd:\n  <<: *c'))).toEqual({ status: 'ok', value: { a: 'f', b: 'value', c: { x: 1 }, d: { '<<': { x: 1 } } }, line: 2 });
  });
});
