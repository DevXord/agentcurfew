import { flagSecrets, knownSecrets, namedSecret, pairs, userNameSecret } from '../rules/secrets.ts';

export const REDACTED = '<redacted>';

const WORD_END = /[\s"'&]|$/g;

/** The text with each [start, end) range replaced by <redacted>; overlapping ranges are joined. */
function replaceRanges(text: string, ranges: [number, number][]): string {
  let result = '';
  let at = 0;
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (end <= at) continue;
    if (start >= at) result += text.slice(at, start) + REDACTED;
    at = end;
  }
  return result + text.slice(at);
}

/** A command-line word or an address with every secret the rules would report replaced by <redacted>. */
export function redact(text: string): string {
  const ranges: [number, number][] = [];
  // A known secret is redacted to the end of its word. Matches come in order, so a match inside the word of the last
  // one ends where that word ends, and no text is read twice.
  let wordEnd = -1;
  for (const match of knownSecrets(text)) {
    if (match.index >= wordEnd) {
      WORD_END.lastIndex = match.index;
      wordEnd = WORD_END.exec(text)?.index ?? text.length;
    }
    ranges.push([match.index, wordEnd]);
  }
  // The value itself, where it stands: the same text may also appear in the key or elsewhere.
  for (const pair of pairs(text)) {
    if (namedSecret(pair.key.replace(/^-+/, ''), pair.value) !== undefined) ranges.push([pair.valueIndex, pair.valueIndex + pair.value.length]);
  }
  let result = replaceRanges(text, ranges);
  try {
    const url = new URL(result);
    let changed = false;
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
    if (changed) result = url.toString().replaceAll(encodeURIComponent(REDACTED), REDACTED);
  } catch {
    // Not an address.
  }
  return result;
}

/** Command-line words, each redacted, and the word after a flag that names a secret (--api-key VALUE) replaced. */
export function redactWords(words: readonly string[]): string[] {
  const secret = new Set(flagSecrets(words).map((found) => found.index));
  return words.map((word, index) => (secret.has(index) ? REDACTED : redact(word)));
}
