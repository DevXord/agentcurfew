import { addresses, flagSecrets, knownSecrets, namedSecret, pairs, userNameSecret } from '../rules/secrets.ts';

export const REDACTED = '<redacted>';

const WORD_END = /[\s"'&]|$/g;

type Range = [start: number, end: number, replacement: string];

/** The text with each [start, end) range replaced; ranges that overlap are joined and become <redacted>. */
function replaceRanges(text: string, ranges: Range[]): string {
  const merged: Range[] = [];
  for (const range of ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = merged.at(-1);
    if (last !== undefined && range[0] < last[1]) merged[merged.length - 1] = [last[0], Math.max(last[1], range[1]), REDACTED];
    else merged.push([...range]);
  }
  let result = '';
  let at = 0;
  for (const [start, end, replacement] of merged) {
    result += text.slice(at, start) + replacement;
    at = end;
  }
  return result + text.slice(at);
}

// A path segment that looks like a key rather than a name: long, with letters and digits, such as the token in
// https://mcp.zapier.com/api/mcp/s/<token>/mcp. Erring on the wide side only masks an identifier.
const TOKEN_SEGMENT = /^(?=[^/]*\d)(?=[^/]*[A-Za-z])[A-Za-z0-9_-]{32,}$/;
// user:password@ at the start of an address that new URL cannot read, such as one with a port over 65535.
const RAW_USERINFO = /^([a-z][a-z0-9+.-]*:\/\/[^/@:\s]*:)([^@/\s]+)(@)/i;

/** An address with its password, a credential as its user name, secret query parameters and key-like path segments replaced, or undefined. */
export function redactAddress(address: string): string | undefined {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    const raw = RAW_USERINFO.exec(address);
    return raw === null ? undefined : address.replace(RAW_USERINFO, `$1${REDACTED}$3`);
  }
  let changed = false;
  const segments = url.pathname.split('/');
  if (segments.some((segment) => TOKEN_SEGMENT.test(segment))) {
    url.pathname = segments.map((segment) => (TOKEN_SEGMENT.test(segment) ? REDACTED : segment)).join('/');
    changed = true;
  }
  if (url.password !== '') {
    url.password = REDACTED;
    changed = true;
  }
  if (userNameSecret(url) !== undefined) {
    url.username = REDACTED;
    changed = true;
  }
  for (const [key, value] of [...url.searchParams]) {
    if (namedSecret(key, value) !== undefined) {
      url.searchParams.set(key, REDACTED);
      changed = true;
    }
  }
  return changed ? url.toString().replaceAll(encodeURIComponent(REDACTED), REDACTED) : undefined;
}

/** A command-line word or an address with every secret the rules would report replaced by <redacted>. */
export function redact(text: string): string {
  const ranges: Range[] = [];
  // A known secret is redacted to the end of its word. Matches come in order, so a match inside the word of the last
  // one ends where that word ends, and no text is read twice.
  let wordEnd = -1;
  for (const match of knownSecrets(text)) {
    if (match.index >= wordEnd) {
      WORD_END.lastIndex = match.index;
      wordEnd = WORD_END.exec(text)?.index ?? text.length;
    }
    ranges.push([match.index, wordEnd, REDACTED]);
  }
  // The value itself, where it stands: the same text may also appear in the key or elsewhere.
  for (const pair of pairs(text)) {
    if (namedSecret(pair.key.replace(/^-+/, ''), pair.value) !== undefined) ranges.push([pair.valueIndex, pair.valueIndex + pair.value.length, REDACTED]);
  }
  // Addresses anywhere in the text, also inside a longer word such as --db=postgres://user:password@host/db.
  for (const { index, url } of addresses(text)) {
    const redacted = redactAddress(url);
    if (redacted !== undefined) ranges.push([index, index + url.length, redacted]);
  }
  return replaceRanges(text, ranges);
}

/** Command-line words, each redacted, and the word after a flag that names a secret (--api-key VALUE) replaced. */
export function redactWords(words: readonly string[]): string[] {
  const secret = new Set(flagSecrets(words).map((found) => found.index));
  return words.map((word, index) => (secret.has(index) ? REDACTED : redact(word)));
}

/**
 * A parsed entry with every secret the rules would report replaced by <redacted>. The lock is meant to be committed, so
 * its hashes must not let anyone confirm a guessed secret offline (Q-015, decision of the maintainer): a change of a
 * secret's value alone is therefore not drift, while any other change is.
 */
export function redactedValue(value: unknown, key?: string): unknown {
  if (typeof value === 'string') return key !== undefined && namedSecret(key, value) !== undefined ? REDACTED : redact(value);
  if (Array.isArray(value)) return value.every((item) => typeof item === 'string') ? redactWords(value as string[]) : value.map((item) => redactedValue(item));
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactedValue(item, name)]));
  return value;
}
