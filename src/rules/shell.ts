// Patterns over the text of shell commands. They read text only: nothing is run or resolved.

const FETCH = String.raw`(?:curl|wget|fetch|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|(?:New-Object\s+(?:System\.)?Net\.WebClient\)?\.)?Download(?:String|File))`;
const SHELL = String.raw`(?:sudo\s+)?(?:(?:ba|z|da|k|fi|c|tc)?sh|pwsh|powershell|python[0-9.]*|node|perl|ruby|php|iex|Invoke-Expression|source|\.)`;

export interface CommandPattern {
  id: 'download-execute' | 'decode-execute' | 'encoded-powershell' | 'network';
  what: string;
  pattern: RegExp;
}

export const DOWNLOAD_EXECUTE: readonly CommandPattern[] = [
  { id: 'download-execute', what: 'downloads code and pipes it to an interpreter', pattern: new RegExp(String.raw`\b${FETCH}\b[^|;&\n]*\|\s*${SHELL}(?![\w-])`, 'i') },
  { id: 'download-execute', what: 'runs the output of a download', pattern: new RegExp(String.raw`(?:\$\(|\x60|<\()\s*${FETCH}\b`, 'i') },
  { id: 'download-execute', what: 'runs downloaded code in PowerShell', pattern: new RegExp(String.raw`\b(?:iex|Invoke-Expression)\b[\s(]*(?:\(?\s*)?${FETCH}`, 'i') },
  { id: 'decode-execute', what: 'decodes hidden code and runs it', pattern: /\b(?:base64\s+(?:-d|--decode|-D)|openssl\s+(?:base64|enc)\s[^|]*-d|xxd\s+-r)\b[^|;&\n]*\|\s*(?:sudo\s+)?(?:(?:ba|z|da|k)?sh|python[0-9.]*|node|perl)\b/i },
  { id: 'encoded-powershell', what: 'runs an encoded PowerShell command', pattern: /\b(?:pwsh|powershell)(?:\.exe)?\b[^\n]*\s-(?:e|ec|enc|encodedcommand)\s+[A-Za-z0-9+/=]{16,}/i },
];

export const NETWORK: CommandPattern = {
  id: 'network',
  what: 'opens a network connection',
  pattern: new RegExp(String.raw`\b(?:${FETCH}|nc|ncat|netcat|socat|telnet|ssh|scp|sftp|rsync|ftp|tftp)\b(?![.-])|/dev/(?:tcp|udp)/|\bhttps?://(?!(?:localhost|127\.0\.0\.1|\[::1\])[:/])`, 'i'),
};

/** Redirection, tee, sed -i, cp or mv onto a file whose name matches `target`. */
export function writesTo(target: string): RegExp {
  const path = String.raw`["']?(?:[^\s"'|;&<>]*/)?${target}["']?(?=$|[\s;&|)])`;
  return new RegExp(String.raw`(?:>>?\s*${path}|\btee\b(?:\s+-a)?\s+${path}|\bsed\s+-i\S*\s+(?:'[^']*'|"[^"]*"|\S+)\s+${path}|\b(?:cp|mv|ln|copy|move|Set-Content|Add-Content|Out-File)\b[^;&|\n]*\s${path})`, 'i');
}
