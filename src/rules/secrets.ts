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
  // https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks shows hooks.slack.com/services/T…/B…/X…; the
  // length follows the gitleaks rule slack-webhook-url (https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml).
  { name: 'Slack webhook', pattern: /\bhooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9+/]{43,56}/ },
  // https://core.telegram.org/bots/api: "The token is a string, like 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11".
  { name: 'Telegram bot token', pattern: /(?<![\w-])\d{5,16}:[A-Za-z0-9_-]{34,35}(?![\w-])/ },
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
// ghs_<app id>_<JWT>; any three dotted parts after ghs_<digits>_ are taken for one, as the issuer's format may vary.
// A pattern such as \beyJ[A-Za-z0-9_-]{8,}\. reads to the end of the run of token characters from every eyJ in it, so
// eyJ-eyJ-eyJ-... costs quadratic time. Here each part is read from the start of its run only, and the token is then
// looked for inside the first part.
const DOTTED = /(?<![A-Za-z0-9_-])([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/g;
const GHS_START = /(?:^|-)ghs_\d+_(?=[A-Za-z0-9_-])/;
const JWT_START = /(?:^|-)eyJ[A-Za-z0-9_-]{8}/;

function dottedTokens(text: string, found: SecretMatch[]): void {
  DOTTED.lastIndex = 0;
  for (let match = DOTTED.exec(text); match !== null; match = DOTTED.exec(text)) {
    const [whole, first = '', second = '', third = ''] = match;
    const ghs = GHS_START.exec(first);
    const jwt = ghs === null && second.startsWith('eyJ') && second.length >= 11 && third.length >= 8 ? JWT_START.exec(first) : null;
    const start = ghs ?? jwt;
    if (start === null) {
      // The second part may still begin a token of its own.
      DOTTED.lastIndex = match.index + first.length + 1;
      continue;
    }
    const index = match.index + start.index + (start[0].startsWith('-') ? 1 : 0);
    found.push({ what: ghs === null ? 'JSON Web Token' : 'GitHub token', masked: maskSecret(text.slice(index, match.index + whole.length)), index });
  }
}

const SECRET_KEY = /(?:^|[^a-z])(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|apikey|access[_-]?key|account[_-]?key|private[_-]?key|credential|auth(?:orization)?|bearer|cookie|session)(?:$|[^a-z])/i;
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

// Compiled once: knownSecrets runs on every word of every server definition.
const GLOBAL = KNOWN.map((shape) => ({ ...shape, global: new RegExp(shape.pattern.source, `${shape.pattern.flags}g`) }));

/** Known credential formats anywhere in a text. */
export function knownSecrets(text: string): SecretMatch[] {
  const found: SecretMatch[] = [];
  for (const { name, global, accept } of GLOBAL) {
    global.lastIndex = 0;
    for (let match = global.exec(text); match !== null; match = global.exec(text)) {
      if (accept?.(match[0]) ?? true) found.push({ what: name, masked: maskSecret(match[0]), index: match.index });
    }
  }
  dottedTokens(text, found);
  return found.sort((a, b) => a.index - b.index);
}

/** A text with every known credential format in it masked; for messages built from command lines (the hook's reasons). */
export function maskKnownSecrets(text: string): string {
  const ranges: [number, number][] = [];
  for (const { global, accept } of GLOBAL) {
    global.lastIndex = 0;
    for (let match = global.exec(text); match !== null; match = global.exec(text)) {
      if (match[0] === '') global.lastIndex++;
      else if (accept?.(match[0]) ?? true) ranges.push([match.index, match.index + match[0].length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let result = '';
  let at = 0;
  for (const [start, end] of ranges) {
    if (start < at) continue;
    result += text.slice(at, start) + maskSecret(text.slice(start, end));
    at = end;
  }
  return result + text.slice(at);
}

// A relative or home path to a file that holds the secret, such as "auth": "~/.config/token". An absolute path such as
// /run/secrets/token is not told from a base64 secret, which starts with / once in 64, so only the key can exempt it.
const PATH = /^(?:\.{1,2}[\\/]|~[\\/]|[A-Za-z]:[\\/])/;
// Keys that name where or what a secret is rather than hold it: --token-file, --auth-server-url, --api-key-env, AUTH_TYPE.
const NOT_A_VALUE = /(?:file|path|dir|directory|folder|url|uri|endpoint|env|var|jar|name|type|provider|server|host|mode|method|scheme|format)$/i;
// The name of an environment variable that holds the secret, as in --api-key-env OPENAI_API_KEY.
const VARIABLE_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
// An address; credentials in it are found by the address checks.
const ADDRESS = /^[a-z][a-z0-9+.-]*:\/\//i;

/** A literal value of a field whose name says it is a secret, when it is not a reference to one. */
export function namedSecret(key: string, value: string): string | undefined {
  if (!SECRET_KEY.test(key) || NOT_A_VALUE.test(key.replace(/[^A-Za-z]+$/, ''))) return undefined;
  const bare = value.trim().replace(SCHEMES, '');
  // A known format is reported by knownSecrets already.
  if (knownSecrets(bare).length > 0) return undefined;
  if (bare.length < 8 || REFERENCE.test(bare) || PLACEHOLDER.test(bare) || PATH.test(bare) || VARIABLE_NAME.test(bare) || ADDRESS.test(bare) || bare.includes('${') || /^\$[A-Za-z_]/.test(bare)) return undefined;
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
const JOINED = /(?:^|[\s"';])(-{0,2}[A-Za-z][\w.-]*)(?:=|:\s*)("[^"]*"|'[^']*'|(?:(?:Bearer|Basic|Token|Bot)\s+)?[^\s"';]+)/dgi;
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

// From the start of a run of scheme characters only: \b[a-z][a-z0-9+.-]*: would rescan a.a.a.a... from every letter.
const ADDRESSES = /(?<![a-z0-9+.-])[0-9+.-]*[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;

/** Addresses anywhere in a text, such as postgres://u:pw@host/db inside --db=..., in linear time. */
export function addresses(text: string): { index: number; url: string }[] {
  const found: { index: number; url: string }[] = [];
  for (const match of text.matchAll(ADDRESSES)) {
    const lead = /^[0-9+.-]*/.exec(match[0])?.[0].length ?? 0;
    found.push({ index: match.index + lead, url: match[0].slice(lead) });
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
