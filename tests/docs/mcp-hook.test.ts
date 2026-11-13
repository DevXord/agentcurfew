// Pins the hook block shown in docs/mcp.md to hookEntry(); a change in one must change the other.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hookEntry } from '../../src/hook/install.ts';

const DOC = fileURLToPath(new URL('../../docs/mcp.md', import.meta.url));

describe('docs/mcp.md hook block', () => {
  it('matches the output of hookEntry() between the markers', () => {
    const text = readFileSync(DOC, 'utf8').replaceAll('\r\n', '\n');
    const block = /<!--\s*hookEntry: start\s*-->\s*```json\n([\s\S]*?)\n```\s*<!--\s*hookEntry: end\s*-->/.exec(text);
    expect(block, 'docs/mcp.md must hold the <!-- hookEntry: start --> ... <!-- hookEntry: end --> block').not.toBeNull();
    const shown = JSON.parse(block![1] as string) as unknown;
    expect(shown).toEqual(hookEntry());
  });
});
