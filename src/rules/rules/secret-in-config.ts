import { mcpEntry } from '../mcp.ts';
import { flagSecrets, knownSecrets, namedSecret, pairs, userNameSecret } from '../secrets.ts';
import { at, entryValue, isWholeFile, strings, texts } from '../text.ts';
import type { Rule, RuleHit } from '../types.ts';

function urlCredentials(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.password !== '') return 'a password in the address';
    if (userNameSecret(parsed) !== undefined) return 'a credential as the user name of the address';
    for (const [key, value] of parsed.searchParams) if (namedSecret(key, value) !== undefined) return `a secret in the query parameter ${key.replace(/\p{C}/gu, '?')}`;
  } catch {
    return undefined;
  }
  return undefined;
}

export const secretInConfig: Rule = {
  id: 'secret-in-config',
  title: 'Secret written into agent configuration',
  level: 'high',
  owasp: ['AST04'],
  description:
    'Finds credentials written as plain values in MCP server definitions, hooks and automatic tasks: known token formats anywhere in them, literal values of fields whose names say they hold a secret (env, headers, --token=..., --token ...), and credentials in addresses, as a password or as a long user name (https://TOKEN@host). Such files are often committed, copied into other repositories and read by every tool that loads the configuration. Values that refer to a variable (${VAR}, $VAR, %VAR%, ${env:VAR}, ${input:id}) or to a file (./pass, ~/.token) are not reported. The secret is never printed in full.',
  fix: 'Remove the value, rotate the credential, and refer to it through an environment variable or the agent\'s input or secret mechanism instead.',
  falsePositives: 'A field named like a secret can hold something harmless, such as a token budget. Known formats are matched by shape and can match test data.',
  example: '"env": { "GITHUB_TOKEN": "ghp_..." }',
  kinds: ['mcp-server', 'hook', 'auto-run'],
  check(component, context) {
    const hits: RuleHit[] = [];
    const seen = new Set<string>();
    const add = (message: string, place: Partial<RuleHit> = {}): void => {
      if (seen.has(message)) return;
      seen.add(message);
      hits.push({ message, ...place });
    };
    for (const source of texts(component)) {
      for (const match of knownSecrets(source.text)) add(`${match.what} in plain text: ${match.masked}`, at(source, match.index));
    }
    const entry = component.kind === 'mcp-server' ? mcpEntry(component, context.knowledge) : undefined;
    if (entry !== undefined) {
      for (const [key, value] of [...Object.entries(entry.env), ...Object.entries(entry.headers)]) {
        if (typeof value !== 'string') continue;
        const masked = namedSecret(key, value);
        if (masked !== undefined) add(`${key.replace(/\p{C}/gu, '?')} holds a literal value: ${masked}`);
      }
      for (const found of flagSecrets(entry.args)) add(`${found.flag.replace(/\p{C}/gu, '?')} is given a literal value: ${found.masked}`);
      for (const url of entry.urls) {
        const problem = urlCredentials(url);
        if (problem !== undefined) add(`the server address holds ${problem}`);
      }
    }
    const value = entryValue(component);
    const lines = value === undefined ? (isWholeFile(component) ? [component.raw] : []) : strings(value).map((item) => item.value);
    for (const line of lines) {
      for (const pair of pairs(line)) {
        const masked = namedSecret(pair.key.replace(/^-+/, ''), pair.value);
        if (masked !== undefined) add(`${pair.key.replace(/\p{C}/gu, '?')} is given a literal value: ${masked}`);
      }
      // From the start of a run of scheme characters only: \b[a-z][a-z0-9+.-]*: would rescan a.a.a.a... from every letter.
      for (const match of line.matchAll(/(?<![a-z0-9+.-])[0-9+.-]*[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi)) {
        const url = match[0].replace(/^[0-9+.-]+/, '');
        // The server's own address is reported above.
        if (entry?.urls.includes(url) === true) continue;
        const problem = urlCredentials(url);
        if (problem !== undefined) add(`an address holds ${problem}`);
      }
    }
    return hits;
  },
};
