import { quote } from '../mask.ts';
import { at, texts } from '../text.ts';
import type { Level, Rule, RuleHit } from '../types.ts';

type Class = { name: string; level: Level };

const TAG: Class = { name: 'Unicode Tag character', level: 'critical' };
const VARIATION: Class = { name: 'variation selector', level: 'high' };
const BIDI: Class = { name: 'bidirectional control', level: 'high' };
const ZERO_WIDTH: Class = { name: 'zero-width character', level: 'medium' };

function classify(code: number): Class | undefined {
  if (code >= 0xe0000 && code <= 0xe007f) return TAG;
  // Supplementary variation selectors carry no meaning on their own and have been used to hide bytes in text.
  if (code >= 0xe0100 && code <= 0xe01ef) return VARIATION;
  if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0x200e || code === 0x200f || code === 0x061c) return BIDI;
  if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0x2060 || code === 0xfeff || code === 0x180e || code === 0x2061 || code === 0x2062 || code === 0x2063 || code === 0x2064) return ZERO_WIDTH;
  return undefined;
}

const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|️/u;

/** A joiner between two emoji, or a byte order mark at the start, is how such text is written, not hidden content. */
function isOrdinary(chars: readonly string[], index: number, code: number): boolean {
  if (code === 0xfeff) return index === 0;
  if (code !== 0x200d && code !== 0x200c) return false;
  return PICTOGRAPH.test(chars[index - 1] ?? '') && PICTOGRAPH.test(chars[index + 1] ?? '');
}

function hex(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

const MAX_CODES = 8;
const LEVEL_ORDER: readonly Level[] = ['critical', 'high', 'medium'];

function describe(run: readonly number[]): RuleHit {
  const classes = [...new Set(run.map((code) => classify(code) as Class))];
  const level = LEVEL_ORDER.find((candidate) => classes.some((item) => item.level === candidate)) ?? 'medium';
  const codes = run.slice(0, MAX_CODES).map(hex).join(' ') + (run.length > MAX_CODES ? ` and ${run.length - MAX_CODES} more` : '');
  const names = classes.map((item) => item.name).join(', ');
  let message = `${run.length} hidden ${run.length === 1 ? 'character' : 'characters'} (${names}): ${codes}`;
  const tags = run.filter((code) => code >= 0xe0020 && code <= 0xe007e);
  if (tags.length > 0) message += `; the Tag characters spell "${quote(String.fromCodePoint(...tags.map((code) => code - 0xe0000)), 80)}"`;
  return { message, level };
}

export const hiddenUnicode: Rule = {
  id: 'hidden-unicode',
  title: 'Hidden Unicode characters',
  level: 'high',
  owasp: ['AST04', 'AST08'],
  description:
    'Finds characters that an editor does not show but a model reads: Unicode Tag characters (U+E0000 to U+E007F), which can spell out whole instructions; supplementary variation selectors; bidirectional controls, which make text display in a different order than it is read; and zero-width characters. Each finding gives the line, the column and the code points.',
  fix: 'Remove the characters. If the file is not yours, treat it as tampered with: find where it came from before trusting the rest of it.',
  falsePositives: 'Right-to-left languages can need bidirectional marks, and some text uses zero-width joiners between letters. Joiners between emoji and a byte order mark at the start of a file are not reported.',
  example: 'A CLAUDE.md line "Run the tests." followed by U+E0049 U+E0067 U+E006E ..., which spells "Ignore previous instructions".',
  kinds: ['skill', 'mcp-server', 'hook', 'auto-run', 'context-file', 'permission', 'subagent', 'command'],
  check(component) {
    const hits: RuleHit[] = [];
    for (const source of texts(component)) {
      if (!/[\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]|\uDB40[\uDC00-\uDDEF]/.test(source.text)) continue;
      const chars = [...source.text];
      let offset = 0;
      let run: number[] = [];
      let start = 0;
      const flush = (): void => {
        if (run.length > 0) hits.push({ ...describe(run), ...at(source, start) });
        run = [];
      };
      chars.forEach((char, index) => {
        const code = char.codePointAt(0) as number;
        if (classify(code) !== undefined && !isOrdinary(chars, index, code)) {
          if (run.length === 0) start = offset;
          run.push(code);
        } else {
          flush();
        }
        offset += char.length;
      });
      flush();
    }
    return hits;
  },
};
