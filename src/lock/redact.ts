import { knownSecrets, namedSecret, pairs } from '../rules/secrets.ts';

export const REDACTED = '<redacted>';

/** A command-line word or an address with every secret the rules would report replaced by <redacted>. */
export function redact(text: string): string {
  let result = text;
  for (const match of knownSecrets(text).reverse()) {
    const end = text.slice(match.index).search(/[\s"'&]|$/);
    result = result.slice(0, match.index) + REDACTED + result.slice(match.index + end);
  }
  for (const pair of pairs(result)) {
    if (namedSecret(pair.key.replace(/^-+/, ''), pair.value) !== undefined) result = result.replace(pair.value, REDACTED);
  }
  try {
    const url = new URL(result);
    let changed = false;
    if (url.password !== '') {
      url.password = REDACTED;
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
