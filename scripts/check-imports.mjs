#!/usr/bin/env node
// Lists the external modules the built bundle imports, and fails if anything outside the runtime allowlist appears.
// Runs on any Node version in engines; no dependencies. The allowlist is Node built-ins plus the runtime dependencies
// of package.json (`yaml`, `smol-toml`) and the optional peer `depcurfew`. Local modules (./ and ../) are kept out of
// the check; everything else must be on the list.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

const ALLOWED = new Set([
  'node:fs', 'node:path', 'node:util', 'node:os', 'node:crypto', 'node:url',
  'yaml', 'smol-toml', 'depcurfew',
]);

const IMPORT = /\b(?:import|export)[^'"`]*?from\s+['"]([^'"]+)['"]/g;
const SIDE_IMPORT = /^\s*import\s+['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;
const REQUIRE = /\brequire\s*\(\s*['"]([^'"]+)['"]/g;

function imports(text) {
  const names = new Set();
  for (const re of [IMPORT, SIDE_IMPORT, DYNAMIC_IMPORT, REQUIRE]) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) names.add(match[1]);
  }
  return names;
}

const files = readdirSync(DIST).filter((name) => name.endsWith('.js'));
if (files.length === 0) {
  console.error('check-imports: dist/ has no .js files; build first');
  process.exit(2);
}

const found = new Set();
let bad = [];
for (const file of files) {
  for (const name of imports(readFileSync(join(DIST, file), 'utf8'))) {
    if (name.startsWith('./') || name.startsWith('../')) continue;
    found.add(name);
    if (!ALLOWED.has(name)) bad.push(`${file}: ${name}`);
  }
}

if (bad.length > 0) {
  console.error('check-imports: dist/ imports are not on the allowlist:');
  for (const line of bad) console.error(`  ${line}`);
  console.error(`Allowlist: ${[...ALLOWED].sort().join(', ')}`);
  process.exit(1);
}

console.log(`check-imports: ${files.length} file(s) OK; imports: ${[...found].sort().join(', ') || '(none)'}`);
