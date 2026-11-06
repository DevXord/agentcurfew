import { writeFileSync } from 'node:fs';
import { renderPolicy } from '../src/policy/render.ts';

writeFileSync(new URL('../docs/policy.md', import.meta.url), renderPolicy());
