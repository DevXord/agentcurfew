import type { CliIo } from './io.ts';

const CODES = {
  red: [31, 39],
  boldRed: [1, 22, 31, 39],
  yellow: [33, 39],
  cyan: [36, 39],
  green: [32, 39],
} as const;

type Tone = keyof typeof CODES;

const TONES: Readonly<Record<string, Tone>> = {
  CRITICAL: 'boldRed',
  HIGH: 'red',
  ERROR: 'red',
  MEDIUM: 'yellow',
  WARNING: 'yellow',
  LOW: 'cyan',
  INFO: 'cyan',
  failed: 'red',
  Drift: 'red',
  Failed: 'red',
  passed: 'green',
  OK: 'green',
};

/**
 * A label, colored when the output allows it. The label's own text always stays, so that nothing is said by color alone,
 * and text from scanned files is never passed here.
 */
export function label(io: CliIo, text: string): string {
  const tone = TONES[text.trim()];
  if (io.color !== true || tone === undefined) return text;
  const codes = CODES[tone];
  const open = codes.length === 4 ? `\u001b[${codes[0]}m\u001b[${codes[2]}m` : `\u001b[${codes[0]}m`;
  const close = codes.length === 4 ? `\u001b[${codes[3]}m\u001b[${codes[1]}m` : `\u001b[${codes[1]}m`;
  return `${open}${text}${close}`;
}

/** Whether a stream gets color: NO_COLOR (any non-empty value) turns it off, FORCE_COLOR on, otherwise a terminal does. */
export function wantsColor(isTTY: boolean | undefined, env: Readonly<Record<string, string | undefined>>): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== 'false') return true;
  return isTTY === true;
}
