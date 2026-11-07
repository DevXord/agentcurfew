import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', '.git']);
// The characters hidden-unicode reports, written as escapes so that this file holds none of them.
const HIDDEN = /[\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]|[\u{E0000}-\u{E01EF}]/u;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

it('the repository holds no hidden characters: code writes them as escapes, fixtures as {U+XXXX}', () => {
  const dirty = files(ROOT).filter((path) => {
    const bytes = readFileSync(path);
    return !bytes.includes(0) && HIDDEN.test(bytes.toString('utf8'));
  });
  expect(dirty.map((path) => path.slice(ROOT.length))).toEqual([]);
});
