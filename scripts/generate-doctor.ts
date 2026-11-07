import { writeFileSync } from 'node:fs';
import { renderDoctor } from '../src/doctor/render.ts';

writeFileSync(new URL('../docs/doctor.md', import.meta.url), renderDoctor());
