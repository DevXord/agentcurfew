import { createHash } from 'node:crypto';

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Text as it is hashed: CRLF and lone CR become LF, so a checkout on Windows and one on Linux hash alike (D-014). */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** JSON with keys sorted at every level, so that reordering keys in a file is not a change. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
