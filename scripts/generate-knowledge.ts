import { writeFileSync } from 'node:fs';
import { renderKnowledge } from '../src/knowledge/render.ts';

writeFileSync(new URL('../docs/knowledge.md', import.meta.url), renderKnowledge());
