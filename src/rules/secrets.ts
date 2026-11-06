import { maskSecret } from './mask.ts';

// Common shapes of well-known credentials. They are facts about the issuers' tokens, not about agents, so they live here
// and not in src/knowledge/. Checked on 2026-11-06 (Q-010) against the source named on each line; where the issuer
// documents only a prefix, the length and characters follow the issuer's own redaction code or the gitleaks rules.
// A shape errs on the wide side: a false match only masks a value, a missed one leaks it.
const KNOWN: readonly { name: string; pattern: RegExp }[] = [
  // https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github#githubs-token-formats
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/ },
  // Same page: installation tokens in the stateless format ghs_<app id>_<JWT>, rolled out from 2026-04-27.
  { name: 'GitHub token', pattern: /\bghs_\d+_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { name: 'GitHub token', pattern: /\bgithub_pat_[A-Za-z0-9_]{50,255}\b/ },
  // https://docs.gitlab.com/security/tokens/#token-prefixes, with the routable form of GitLab's own secret-detection rules.
  { name: 'GitLab token', pattern: /\bglpat-[A-Za-z0-9_-]{20,300}(?:\.[0-9a-z]{2})?(?:\.[0-9a-z]{9})?/ },
  // https://platform.claude.com/docs/en/get-api-key: "starts with sk-ant-"; no length is documented.
  { name: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  // OpenAI documents no format; sk- with a digit in the body covers its keys and the many APIs that copied the shape.
  { name: 'sk- API key (OpenAI and others)', pattern: /\bsk-(?!ant-)(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{20,}/ },
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
  // RFC 7519: base64url parts separated by dots; here three, the first two JSON objects starting with {"
  { name: 'JSON Web Token', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
];

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
  for (const { name, pattern } of KNOWN) {
    const global = new RegExp(pattern.source, `${pattern.flags}g`);
    for (const match of text.matchAll(global)) found.push({ what: name, masked: maskSecret(match[0]), index: match.index });
  }
  return found.sort((a, b) => a.index - b.index);
}

/** A literal value of a field whose name says it is a secret, when it is not a reference to one. */
export function namedSecret(key: string, value: string): string | undefined {
  if (!SECRET_KEY.test(key)) return undefined;
  const bare = value.trim().replace(SCHEMES, '');
  // A known format is reported by knownSecrets already.
  if (knownSecrets(bare).length > 0) return undefined;
  if (bare.length < 8 || REFERENCE.test(bare) || PLACEHOLDER.test(bare) || bare.includes('${') || /^\$[A-Za-z_]/.test(bare)) return undefined;
  return maskSecret(bare);
}

/** key=value and key: value pairs inside a command line or header string, such as --token=abc or "Authorization: abc". */
export function pairs(text: string): { key: string; value: string; index: number }[] {
  const list: { key: string; value: string; index: number }[] = [];
  for (const match of text.matchAll(/(?:^|[\s"'])(-{0,2}[A-Za-z][\w.-]*)(?:=|:\s*)("[^"]*"|'[^']*'|(?:(?:Bearer|Basic|Token|Bot)\s+)?[^\s"']+)/gi)) {
    const raw = match[2] ?? '';
    list.push({ key: match[1] ?? '', value: raw.replace(/^["']|["']$/g, ''), index: match.index });
  }
  return list;
}
