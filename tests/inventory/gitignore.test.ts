import { describe, expect, it } from 'vitest';
import { isIgnored, parseGitignore } from '../../src/inventory/gitignore.ts';

const ignored = (text: string, path: string) => isIgnored(parseGitignore(text), path);

describe('.gitignore subset', () => {
  it('ignores folders, names anywhere and anchored paths', () => {
    expect(ignored('dist/', 'dist/cli.js')).toBe(true);
    expect(ignored('dist/', 'src/dist/cli.js')).toBe(true);
    expect(ignored('dist/', 'dist')).toBe(false);
    expect(ignored('node_modules/', 'node_modules/depcurfew/dist/cli.js')).toBe(true);
    expect(ignored('/build', 'build/x.js')).toBe(true);
    expect(ignored('/build', 'src/build/x.js')).toBe(false);
    expect(ignored('tools/gen', 'tools/gen/x.sh')).toBe(true);
    expect(ignored('*.log', 'logs/a.log')).toBe(true);
    expect(ignored('*.log', 'a.sh')).toBe(false);
  });

  it('supports ** and ?', () => {
    expect(ignored('**/out/', 'a/b/out/x.js')).toBe(true);
    expect(ignored('docs/**/*.tmp', 'docs/a/b/c.tmp')).toBe(true);
    expect(ignored('docs/**/*.tmp', 'docs/c.tmp')).toBe(true);
    expect(ignored('file?.sh', 'file1.sh')).toBe(true);
  });

  it('lets the last line win, but not inside an ignored folder', () => {
    expect(ignored('*.sh\n!keep.sh', 'keep.sh')).toBe(false);
    expect(ignored('*.sh\n!keep.sh', 'drop.sh')).toBe(true);
    expect(ignored('dist/\n!dist/keep.js', 'dist/keep.js')).toBe(true);
  });

  it('skips comments, blank lines and escapes', () => {
    expect(ignored('# dist/\n\n', 'dist/x.js')).toBe(false);
    expect(ignored('\\#hash', '#hash')).toBe(true);
  });

  it('matches a long hostile file in reasonable time', () => {
    const text = `${'**/'.repeat(200)}x\n`.repeat(50);
    const started = performance.now();
    ignored(text, `${'a/'.repeat(30)}y`);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
