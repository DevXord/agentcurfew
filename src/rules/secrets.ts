import { maskSecret } from './mask.ts';

// Common shapes of well-known credentials. They are facts about the issuers' tokens, not about agents, so they live here
// and not in src/knowledge/. Checked on 2026-11-06 (Q-010) against the source named on each line; where the issuer
// documents only a prefix, the length and characters follow the issuer's own redaction code or the gitleaks rules.
// A shape errs on the wide side: a false match only masks a value, a missed one leaks it.
// Text is hostile, so no shape may rescan the same text from many starts (see dottedTokens): every one runs in linear time.
const KNOWN: readonly { name: string; pattern: RegExp; accept?: (match: string) => boolean }[] = [
  // https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github#githubs-token-formats
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/ },
  // Same page: installation tokens in the stateless format ghs_<app id>_<JWT>, rolled out from 2026-04-27: see dottedTokens.
  { name: 'GitHub token', pattern: /\bgithub_pat_[A-Za-z0-9_]{50,255}\b/ },
  // https://docs.gitlab.com/security/tokens/#token-prefixes, with the routable form of GitLab's own secret-detection rules.
  { name: 'GitLab token', pattern: /\bglpat-[A-Za-z0-9_-]{20,300}(?:\.[0-9a-z]{2})?(?:\.[0-9a-z]{9})?/ },
  // https://platform.claude.com/docs/en/get-api-key: "starts with sk-ant-"; no length is documented.
  { name: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  // OpenAI documents no format; sk- with a digit in the body covers its keys and the many APIs that copied the shape.
  // The digit is checked after the match: a look-ahead for it would rescan the rest of the text from every sk-.
  { name: 'sk- API key (OpenAI and others)', pattern: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}/, accept: (match) => /\d/.test(match) },
  // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html#identifiers-prefixes
  { name: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  // https://cloud.google.com/docs/authentication/api-keys: 39 characters of letters, digits, _ and -; a key may end in -.
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/ },
  // https://docs.slack.dev/authentication/tokens: xoxb, xoxp, xoxa, xoxr, xoxe (rotation), xapp (app-level), xwfp (workflow).
  { name: 'Slack token', pattern: /\b(?:xox[abposre]|xapp|xwfp)-[A-Za-z0-9-]{10,}/ },
  // https://docs.stripe.com/keys and https://docs.stripe.com/keys/restricted-api-keys
  { name: 'Stripe key', pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/ },
  // npm documents no format; this is npm's own redaction pattern, https://github.com/npm/redact/blob/main/lib/matchers.js
  { name: 'npm token', pattern: /\bnpms?_[A-Za-z0-9]{36,48}\b/ },
  // https://huggingface.co/docs/hub/security-tokens: "hf_..."; no length is documented.
  { name: 'Hugging Face token', pattern: /\bhf_[A-Za-z0-9]{30,}\b/ },
  // RFC 7468 labels, with those of OpenSSL (pem.h: SM2, ENCRYPTED, ANY), OpenSSH and GnuPG (PGP PRIVATE KEY BLOCK).
  { name: 'private key', pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  // JSON Web Tokens: see dottedTokens.
];

// RFC 7519: a JSON Web Token is base64url parts separated by dots; here three, the first two JSON objects, so starting
// with eyJ (the encoding of {"), each part at least 8 characters. GitHub's stateless installation tokens are
// ghs_<app id>_<JWT>. A pattern such as \beyJ[A-Za-z0-9_-]{8,}\. reads to the end of the run of token characters from
// every eyJ in it, so eyJ-eyJ-eyJ-... costs quadratic time. Here each part is read from the start of its run only, and
// the token is then looked for inside the first part.
const DOTTED = /(?<![A-Za-z0-9_-])([A-Za-z0-9_-]{11,})\.(eyJ[A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})/g;
const TOKEN_START = /(?:^|-)(ghs_\d+_)?eyJ[A-Za-z0-9_-]{8}/;

function dottedTokens(text: string, found: SecretMatch[]): void {
  const pattern = new RegExp(DOTTED.source, DOTTED.flags);
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const part = match[1] ?? '';
    const start = TOKEN_START.exec(part);
    if (start === null) {
      // The second part may still begin a token of its own.
      pattern.lastIndex = match.index + part.length + 1;
      continue;
    }
    const index = match.index + start.index + (start[0].startsWith('-') ? 1 : 0);
    found.push({ what: start[1] === undefined ? 'JSON Web Token' : 'GitHub token', masked: maskSecret(text.slice(index, match.index + match[0].length)), index });
  }
}

const SECRET_KEY = /(?:^|[^a-z])(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential|auth(?:orization)?|bearer|cookie|session)(?:$|[^a-z])/i;
// A reference to a value kept elsewhere: ${VAR}, $VAR, %VAR%, ${env:VAR}, ${input:id}, {env:VAR}, <placeholder>.
const REFERENCE = /^(?:\$\{[^}]*\}|\$[A-Za-z_]\w*|%[A-Za-z_]\w*%|\{\{?[^}]*\}?\}|<[^>]*>)$/;
const PLACEHOLDER = /^(?:your[\w-]*|x{3,}|\*{3,}|\.{3,}|changeme|placeholder|todo|redacted|example|none|null|true|false|\d{1,7})$/i;
const SCHEMES = /^(?:bearer|basic|token|bot)\s+/i;

export interface SecretMatch {
  what: string;
  /** Already masked. */
  masked: string;
  index: number;
}

/** Known credential formats anywhere in a text. */
export function knownSecrets(text: string): SecretMatch[] {
  const found: SecretMatch[] = [];
  for (const { name, pattern, accept } of KNOWN) {
    const global = new RegExp(pattern.source, `${pattern.flags}g`);
    for (const match of text.matchAll(global)) if (accept?.(match[0]) ?? true) found.push({ what: name, masked: maskSecret(match[0]), index: match.index });
  }
  dottedTokens(text, found);
  return found.sort((a, b) => a.index - b.index);
}

// A path to a file that holds the secret, such as --password-file ./pass or "auth": "~/.config/token".
const PATH = /^(?:\.{0,2}[\\/]|~[\\/]|[A-Za-z]:[\\/])/;

/** A literal value of a field whose name says it is a secret, when it is not a reference to one. */
export function namedSecret(key: string, value: string): string | undefined {
  if (!SECRET_KEY.test(key)) return undefined;
  const bare = value.trim().replace(SCHEMES, '');
  // A known format is reported by knownSecrets already.
  if (knownSecrets(bare).length > 0) return undefined;
  if (bare.length < 8 || REFERENCE.test(bare) || PLACEHOLDER.test(bare) || PATH.test(bare) || bare.includes('${') || /^\$[A-Za-z_]/.test(bare)) return undefined;
  return maskSecret(bare);
}

export interface Pair {
  key: string;
  /** Without its quotes. */
  value: string;
  index: number;
  /** Where the value starts in the text, after an opening quote. */
  valueIndex: number;
}

// key=value and key: value. The value may be quoted, or follow an authorization scheme.
const JOINED = /(?:^|[\s"'])(-{0,2}[A-Za-z][\w.-]*)(?:=|:\s*)("[^"]*"|'[^']*'|(?:(?:Bearer|Basic|Token|Bot)\s+)?[^\s"']+)/dgi;
// --flag value: only flags whose names say they hold a secret are kept, since any flag can take an argument.
const SPACED = /(?:^|[\s"'])(-{1,2}[A-Za-z][\w.-]*)\s+("[^"]*"|'[^']*'|[^\s"'-][^\s"']*)/dg;

/** key=value, key: value and --secret-flag value inside a command line or header string, such as --token=abc, --token abc or "Authorization: abc". */
export function pairs(text: string): Pair[] {
  const list: Pair[] = [];
  for (const [pattern, keep] of [[JOINED, () => true], [SPACED, (key: string) => SECRET_KEY.test(key.replace(/^-+/, ''))]] as const) {
    for (const match of text.matchAll(pattern)) {
      const key = match[1] ?? '';
      if (!keep(key)) continue;
      const raw = match[2] ?? '';
      const quoted = /^["']/.test(raw) && raw.length >= 2 && raw.endsWith(raw[0] ?? '');
      list.push({ key, value: quoted ? raw.slice(1, -1) : raw, index: match.index, valueIndex: (match.indices?.[2]?.[0] ?? 0) + (quoted ? 1 : 0) });
    }
  }
  return list.sort((a, b) => a.index - b.index);
}

/** Separate command-line words that hold a secret: the word after a flag whose name says it is one, as in --api-key VALUE. */
export function flagSecrets(words: readonly string[]): { index: number; flag: string; masked: string }[] {
  const found: { index: number; flag: string; masked: string }[] = [];
  for (const [index, word] of words.entries()) {
    const flag = /^-{1,2}([A-Za-z][\w.-]*)$/.exec(word);
    const next = words[index + 1];
    if (flag === null || next === undefined || next.startsWith('-')) continue;
    const masked = namedSecret(flag[1] ?? '', next);
    if (masked !== undefined) found.push({ index: index + 1, flag: word, masked });
  }
  return found;
}

/** The user name of an address, as in https://TOKEN@host, when it looks like a credential rather than a name. */
export function userNameSecret(url: URL): string | undefined {
  let name: string;
  try {
    name = decodeURIComponent(url.username);
  } catch {
    name = url.username;
  }
  if (url.password !== '' || name.length < 16 || !/\d/.test(name) || !/[A-Za-z]/.test(name) || REFERENCE.test(name) || name.includes('${')) return undefined;
  return maskSecret(name);
}
