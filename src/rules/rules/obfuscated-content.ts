import { at, texts } from '../text.ts';
import type { Rule, RuleHit } from '../types.ts';

const BASE64_RUN = /(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/]{1024,}={0,2}(?![A-Za-z0-9+/=])/;
const LONG_LINE = 5000;
// Spaces per character of a line of prose, at the least (field test of 2026-11-09: a 5082-character paragraph).
const PROSE_SPACES = 0.14;
// Data files where long lines are normal.
const DATA_FILE = /\.(?:json|lock|svg|csv|tsv|map|ipynb|txt)$/i;

export const obfuscatedContent: Rule = {
  id: 'obfuscated-content',
  title: 'Content that cannot be reviewed',
  level: 'medium',
  owasp: ['AST01'],
  description:
    'Finds what a reviewer cannot read in a skill: programs (ELF, PE, Mach-O, WebAssembly) and other binary files in the skill folder, long base64 blocks (1 KB or more), and minified lines over 5000 characters in scripts and Markdown. Images, fonts and PDFs are not reported.',
  levels: 'high for a compiled program in the skill folder',
  fix: 'Ship source code instead of binaries and encoded blobs, so that the skill can be read before it is used. If a binary is needed, document where it comes from and lock its checksum.',
  falsePositives: 'A skill may embed an image as base64 or include a generated file on purpose.',
  example: 'skills/helper/bin/tool, an ELF program next to SKILL.md',
  kinds: ['skill'],
  check(component) {
    const hits: RuleHit[] = [];
    for (const file of component.files ?? []) {
      if (file.type === 'executable') hits.push({ message: 'a compiled program in the skill folder', level: 'high', inFile: file.path });
      else if (file.type === 'binary') hits.push({ message: 'a binary file in the skill folder', inFile: file.path });
    }
    for (const source of texts(component)) {
      const base64 = BASE64_RUN.exec(source.text);
      if (base64 !== null && !/data:image\/[\w+.-]+;base64,$/i.test(source.text.slice(Math.max(0, base64.index - 40), base64.index))) {
        hits.push({ message: `a base64 block of ${base64[0].length} characters`, ...at(source, base64.index) });
      }
      if (source.inFile !== undefined && DATA_FILE.test(source.inFile)) continue;
      let start = 0;
      for (const line of source.text.split('\n')) {
        // A long paragraph of prose has a space every few words; minified code and packed data have few.
        if (line.length > LONG_LINE && (line.match(/ /g)?.length ?? 0) < line.length * PROSE_SPACES) {
          hits.push({ message: `a line of ${line.length} characters, which looks minified or generated`, ...at(source, start) });
          break;
        }
        start += line.length + 1;
      }
    }
    return hits;
  },
};
