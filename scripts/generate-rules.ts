import { writeFileSync } from 'node:fs';
import { renderRules } from '../src/rules/render.ts';

writeFileSync(new URL('../docs/rules.md', import.meta.url), renderRules());
