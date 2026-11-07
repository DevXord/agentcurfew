import fc from 'fast-check';
import { describe, it } from 'vitest';
import { knownSecrets } from '../../src/rules/secrets.ts';
import { DOWNLOAD_EXECUTE, writesTo } from '../../src/rules/shell.ts';

// The linear patterns replaced regular expressions that cost quadratic time on hostile text (docs/CHANGELOG-dev.md,
// 2026-11-07). On short text the cost does not matter, so the old expressions serve as the reference for what is found.
// One difference is intended: the old ones took a newline for a space inside a command (pwsh, newline, -enc ...), but a
// newline ends a shell command, so the references below match only spaces there, as the new patterns do.
const FETCH = String.raw`(?:curl|wget|fetch|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|(?:New-Object\s+(?:System\.)?Net\.WebClient\)?\.)?Download(?:String|File))`;
const SHELL = String.raw`(?:sudo\s+)?(?:(?:ba|z|da|k|fi|c|tc)?sh|pwsh|powershell|python[0-9.]*|node|perl|ruby|php|iex|Invoke-Expression|source|\.)`;
const OLD: Record<string, RegExp> = {
  'downloads code and pipes it to an interpreter': new RegExp(String.raw`\b${FETCH}\b[^|;&\n]*\|\s*${SHELL}(?![\w-])`, 'i'),
  'decodes hidden code and runs it': /\b(?:base64\s+(?:-d|--decode|-D)|xxd\s+-r)\b[^|;&\n]*\|\s*(?:sudo\s+)?(?:(?:ba|z|da|k)?sh|python[0-9.]*|node|perl)\b/i,
  'runs an encoded PowerShell command': /\b(?:pwsh|powershell)(?:\.exe)?\b[^\n]*[^\S\n]-(?:e|ec|enc|encodedcommand)[^\S\n]+[A-Za-z0-9+/=]{16,}/i,
};
const OLD_JWT = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const OLD_SK = /\bsk-(?!ant-)(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{20,}/g;
const OLD_COPY = (target: string) => new RegExp(String.raw`\b(?:cp|mv|ln|copy|move|Set-Content|Add-Content|Out-File)\b[^;&|\n]*[^\S\n]["']?(?:[^\s"'|;&<>]*/)?${target}["']?(?=$|[\s;&|)])`, 'i');

const pieces = (parts: string[]) => fc.array(fc.constantFrom(...parts), { maxLength: 14 }).map((list) => list.join(''));

describe('linear patterns', () => {
  it('find the commands the old expressions found', () => {
    const command = pieces(['curl ', 'wget -q ', 'x', ' ', '|', '| ', 'sh', 'bash', ';', '&', '\n', 'base64 -d ', 'xxd -r ', 'pwsh ', 'powershell.exe ', '-enc ', '-e ', 'QUJDREVGR0hJSktMTU5PUA', 'sudo ', 'python3', '-', 'node']);
    fc.assert(
      fc.property(command, (text) => DOWNLOAD_EXECUTE.every((pattern) => {
        const old = OLD[pattern.what];
        return old === undefined || (pattern.pattern.exec(text)?.index ?? -1) === (old.exec(text)?.index ?? -1);
      })),
      { numRuns: 5000 },
    );
  });

  it('find the cp and mv writes the old expression found', () => {
    const write = writesTo(String.raw`CLAUDE\.md`);
    const command = pieces(['cp ', 'mv ', 'x ', 'CLAUDE.md', ' ', './', 'a/', ';', '|', '&', '\n', '"', "'", ')', '-f ']);
    fc.assert(
      fc.property(command, (text) => !OLD_COPY(String.raw`CLAUDE\.md`).test(text) || write.test(text)),
      { numRuns: 5000 },
    );
  });

  it('find the JSON Web Tokens and sk- keys the old expressions found', () => {
    const text = pieces(['eyJ', 'abcdefgh', '12', '.', '-', '_', ' ', 'sk-', 'ant-', 'x', 'ghs_1_']);
    fc.assert(
      fc.property(text, (input) => {
        const found = knownSecrets(input);
        const at = (what: string) => found.filter((match) => match.what === what).map((match) => match.index);
        const old = (pattern: RegExp) => [...input.matchAll(pattern)].map((match) => match.index);
        return JSON.stringify(at('JSON Web Token')) === JSON.stringify(old(OLD_JWT)) && JSON.stringify(at('sk- API key (OpenAI and others)')) === JSON.stringify(old(OLD_SK));
      }),
      { numRuns: 5000 },
    );
  });
});
