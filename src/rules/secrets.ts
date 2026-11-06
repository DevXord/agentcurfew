import { maskSecret } from './mask.ts';

// Common shapes of well-known credentials. They are facts about the issuers' tokens, not about agents, so they live here
// and not in src/knowledge/. They were written from the publicly known prefixes and were not re-checked against each
// issuer's documentation (Q-010), so a shape may be too narrow or too wide.
const KNOWN: readonly { name: string; pattern: RegExp }[] = [
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/ },
  { name: 'GitHub token', pattern: /\bgithub_pat_[A-Za-z0-9_]{50,255}\b/ },
  { name: 'GitLab token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', pattern: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { name: 'Stripe key', pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/ },
  { name: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'Hugging Face token', pattern: /\bhf_[A-Za-z0-9]{30,}\b/ },
  { name: 'private key', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  // Three base64url parts, the first two JSON objects starting with {"
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
