import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Secret-shaped values are built here, so that no file in the repository looks like a live credential.
const SECRETS: Readonly<Record<string, string>> = {
  github: `ghp${'_'}${'Ab1'.repeat(12)}`,
  aws: `AKI${'A'}${'Q7'.repeat(8)}`,
};

/** Hidden characters and secrets are written {U+XXXX} and {{secret:name}} in fixtures, and made real only in a copy. */
export function expand(text: string): string {
  return text
    .replace(/\{U\+([0-9A-F]{4,6})\}/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\{\{secret:(\w+)\}\}/g, (_, name: string) => SECRETS[name] ?? '');
}

export const fixtureDir = (path: string) => fileURLToPath(new URL(`../fixtures/rules/${path}`, import.meta.url));

/** A temporary copy of a rule fixture with its placeholders expanded; call cleanup when done. */
export function materialize(path: string): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'acf-rule-'));
  cpSync(fixtureDir(path), root, { recursive: true });
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        visit(full);
        continue;
      }
      const bytes = readFileSync(full);
      if (bytes.includes(0)) continue;
      const text = bytes.toString('utf8');
      const expanded = expand(text);
      if (expanded !== text) writeFileSync(full, expanded);
    }
  };
  visit(root);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
