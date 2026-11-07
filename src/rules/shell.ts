// Patterns over the text of shell commands. They read text only: nothing is run or resolved.
//
// Text is hostile, so every pattern reads it in linear time. A regular expression such as \bcurl\b[^|]*\| rescans the
// rest of the line from every "curl" when no pipe follows, which is quadratic: a padded command would stall the scan
// and the hook. The patterns below find the first word of a pipeline stage or of a line instead, and look no further.
// A newline ends a command, so unlike those expressions they do not take it for a space inside one.

const FETCH = String.raw`(?:curl|wget|fetch|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|(?:New-Object\s+(?:System\.)?Net\.WebClient\)?\.)?Download(?:String|File))`;
const SHELL = String.raw`(?:sudo\s+)?(?:(?:ba|z|da|k|fi|c|tc)?sh|pwsh|powershell|python[0-9.]*|node|perl|ruby|php|iex|Invoke-Expression|source|\.)`;

/** What a pattern found: where it starts. */
export interface Found {
  index: number;
}

/** The part of RegExp that the rules use, so that a pattern can be a function as well. */
export interface Matcher {
  exec(text: string): Found | null;
  test(text: string): boolean;
}

export interface CommandPattern {
  id: 'download-execute' | 'decode-execute' | 'encoded-powershell' | 'network';
  what: string;
  pattern: Matcher;
}

function matcher(exec: (text: string) => Found | null): Matcher {
  return { exec, test: (text) => exec(text) !== null };
}

/** The first match of a pattern without the g or y flag, which keeps no state between calls. */
function first(pattern: RegExp, text: string): number | undefined {
  const match = pattern.exec(text);
  return match === null ? undefined : match.index;
}

function earliest(...indexes: (number | undefined)[]): Found | null {
  const found = indexes.filter((index): index is number => index !== undefined);
  return found.length === 0 ? null : { index: Math.min(...found) };
}

/**
 * The first pipeline stage whose producer pattern matches and whose output is piped into the consumer.
 * Stages are split at |, ;, & and newlines, so each character is read a fixed number of times.
 * `consumer` is sticky and starts at the pipe.
 */
function pipedInto(text: string, producer: (stage: string) => number | undefined, consumer: RegExp): Found | null {
  let start = 0;
  for (const separator of text.matchAll(/[|;&\n]/g)) {
    if (separator[0] === '|') {
      consumer.lastIndex = separator.index;
      if (consumer.test(text)) {
        const index = producer(text.slice(start, separator.index));
        if (index !== undefined) return { index: start + index };
      }
    }
    start = separator.index + 1;
  }
  return null;
}

const FETCH_WORD = new RegExp(String.raw`\b${FETCH}\b`, 'i');
const INTO_SHELL = new RegExp(String.raw`\|\s*${SHELL}(?![\w-])`, 'iy');
const DECODER = /\b(?:base64\s+(?:-d|--decode|-D)|xxd\s+-r)\b/i;
const OPENSSL = /\bopenssl\s+(?:base64|enc)\s/i;
const DECODE_FLAG = /-d\b/i;
const INTO_DECODED = /\|\s*(?:sudo\s+)?(?:(?:ba|z|da|k)?sh|python[0-9.]*|node|perl)\b/iy;
const POWERSHELL = /\b(?:pwsh|powershell)(?:\.exe)?\b/i;
const ENCODED = /\s-(?:e|ec|enc|encodedcommand)\s+[A-Za-z0-9+/=]{16,}/iy;

function decoder(stage: string): number | undefined {
  const openssl = OPENSSL.exec(stage);
  const decodes = openssl !== null && DECODE_FLAG.test(stage.slice(openssl.index + openssl[0].length));
  return earliest(first(DECODER, stage), decodes ? openssl.index : undefined)?.index;
}

/** pwsh or powershell, then -e, -ec, -enc or -encodedcommand with a long argument later on the same line. */
function encodedPowershell(text: string): Found | null {
  let offset = 0;
  for (const line of text.split('\n')) {
    const shell = POWERSHELL.exec(line);
    if (shell !== null) {
      // Only the first pwsh of a line matters: a later one sees a part of what the first sees.
      for (let at = line.indexOf('-', shell.index + shell[0].length - 1); at > 0; at = line.indexOf('-', at + 1)) {
        ENCODED.lastIndex = at - 1;
        if (ENCODED.test(line)) return { index: offset + shell.index };
      }
    }
    offset += line.length + 1;
  }
  return null;
}

export const DOWNLOAD_EXECUTE: readonly CommandPattern[] = [
  { id: 'download-execute', what: 'downloads code and pipes it to an interpreter', pattern: matcher((text) => pipedInto(text, (stage) => first(FETCH_WORD, stage), INTO_SHELL)) },
  { id: 'download-execute', what: 'runs the output of a download', pattern: new RegExp(String.raw`(?:\$\(|\x60|<\()\s*${FETCH}\b`, 'i') },
  { id: 'download-execute', what: 'runs downloaded code in PowerShell', pattern: new RegExp(String.raw`\b(?:iex|Invoke-Expression)\b[\s(]*(?:\(?\s*)?${FETCH}`, 'i') },
  { id: 'decode-execute', what: 'decodes hidden code and runs it', pattern: matcher((text) => pipedInto(text, decoder, INTO_DECODED)) },
  { id: 'encoded-powershell', what: 'runs an encoded PowerShell command', pattern: matcher(encodedPowershell) },
];

export const NETWORK: CommandPattern = {
  id: 'network',
  what: 'opens a network connection',
  pattern: new RegExp(String.raw`\b(?:${FETCH}|nc|ncat|netcat|socat|telnet|ssh|scp|sftp|rsync|ftp|tftp)\b(?![.-])|/dev/(?:tcp|udp)/|\bhttps?://(?!(?:localhost|127\.0\.0\.1|\[::1\])[:/])`, 'i'),
};

const COPY = /\b(?:cp|mv|ln|copy|move|Set-Content|Add-Content|Out-File)\b/i;

/** Redirection, tee, sed -i, cp or mv onto a file whose name matches `target`. */
export function writesTo(target: string): Matcher {
  const path = String.raw`["']?(?:[^\s"'|;&<>]*/)?${target}["']?(?=$|[\s;&|)])`;
  const direct = new RegExp(String.raw`>>?\s*${path}|\btee\b(?:\s+-a)?\s+${path}|\bsed\s+-i\S*\s+(?:'[^']*'|"[^"]*"|\S+)\s+${path}`, 'i');
  const argument = new RegExp(String.raw`\s${path}`, 'i');
  // cp and the like: the first one of each command, then the target among its arguments. A later cp in the same
  // command sees a part of what the first sees, so looking further would only rescan the same text.
  const copied = (text: string): number | undefined => {
    let start = 0;
    for (const command of text.split(/[;&|\n]/)) {
      const word = COPY.exec(command);
      if (word !== null && argument.test(command.slice(word.index + word[0].length))) return start + word.index;
      start += command.length + 1;
    }
    return undefined;
  };
  return matcher((text) => earliest(first(direct, text), copied(text)));
}
