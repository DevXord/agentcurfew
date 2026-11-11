// Command lines read as words: nothing is run, expanded or resolved.

/** Here-documents read inside here-documents, at most; found by the review of 2026-11-09, where 8000 levels overflowed the stack. */
const MAX_HEREDOC_DEPTH = 8;

/**
 * The shell a command line is written for: sh (bash and the like), PowerShell, or cmd. Each quotes and escapes in its
 * own way, and only sh gives a backslash a meaning, so .claude\settings.json is a path in the other two.
 */
export type Dialect = 'sh' | 'powershell' | 'cmd';

// Escapes of bash's $'…' quoting, decoded so that $'\x43LAUDE.md' reads as CLAUDE.md (review of 2026-11-10).
const ANSI_C: Readonly<Record<string, string>> = {
  a: String.fromCharCode(7),
  b: String.fromCharCode(8),
  e: String.fromCharCode(27),
  E: String.fromCharCode(27),
  f: String.fromCharCode(12),
  n: String.fromCharCode(10),
  r: String.fromCharCode(13),
  t: String.fromCharCode(9),
  v: String.fromCharCode(11),
  '\\': '\\',
  "'": "'",
  '"': '"',
  '?': '?',
};
const HEX_DIGITS: Readonly<Record<string, number>> = { x: 2, u: 4, U: 8 };
const ESCAPE: Readonly<Record<Dialect, string>> = { sh: '\\', powershell: '`', cmd: '^' };
const SH_QUOTED_ESCAPES = '$`"\\\n';

/** The text of $'…' whose opening quote is at start, decoded, and the index of its closing quote. Linear in what it reads. */
function ansiC(line: string, start: number): { text: string; end: number } {
  let text = '';
  let index = start + 1;
  for (; index < line.length && line[index] !== "'"; index++) {
    const char = line[index] as string;
    if (char !== '\\' || index + 1 >= line.length) {
      text += char;
      continue;
    }
    const next = line[++index] as string;
    const digits = HEX_DIGITS[next];
    const hex = digits === undefined ? null : new RegExp(`^[0-9a-fA-F]{1,${digits}}`).exec(line.slice(index + 1, index + 1 + digits));
    const octal = /^[0-7]{1,3}/.exec(line.slice(index, index + 3));
    if (hex !== null) {
      const code = Number.parseInt(hex[0], 16);
      if (code <= 0x10ffff) text += String.fromCodePoint(code);
      index += hex[0].length;
    } else if (octal !== null) {
      text += String.fromCharCode(Number.parseInt(octal[0], 8) & 0xff);
      index += octal[0].length - 1;
    } else if (next === 'c' && index + 1 < line.length) {
      text += String.fromCharCode(line.charCodeAt(++index) & 0x1f);
    } else {
      text += ANSI_C[next] ?? `\\${next}`;
    }
  }
  return { text, end: index };
}

/**
 * Words of one simple command, with quotes removed; commands are split on ;, &&, ||, |, newlines, parentheses and, in
 * sh, backquotes outside quotes, so that (cmd), $(cmd) and `cmd` are commands of their own. Each dialect quotes as its
 * shell does: sh escapes with a backslash and decodes $'…', PowerShell escapes with a backtick and doubles a quote
 * inside quotes, cmd escapes with a caret and has no single quotes.
 */
export function commands(line: string, dialect: Dialect = 'sh', depth = 0): string[][] {
  const result: string[][] = [];
  let words: string[] = [];
  let word = '';
  let quoted: '"' | "'" | undefined;
  let started = false;
  const endWord = () => {
    if (started) words.push(word);
    word = '';
    started = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) result.push(words);
    words = [];
  };
  // Here-documents (<<EOF … EOF): their lines are data for the command, such as a commit message, so they are one word
  // of it, not commands. Only a shell runs them, as in bash <<EOF or cat <<EOF | sh; then they are commands.
  const pending: { delimiter: string; strip: boolean }[] = [];
  let lineStart = 0;
  const readBodies = (newline: number): number => {
    let at = newline + 1;
    const runsBody = SHELL_CONSUMER.test(name(words[0] ?? '')) || PIPED_TO_SHELL.test(line.slice(lineStart, newline));
    for (const { delimiter, strip } of pending.splice(0)) {
      const lines: string[] = [];
      while (at <= line.length) {
        const end = line.indexOf('\n', at) === -1 ? line.length : line.indexOf('\n', at);
        const text = line.slice(at, end);
        at = end + 1;
        if ((strip ? text.replace(/^\t+/, '') : text) === delimiter) break;
        lines.push(text);
      }
      const body = lines.join('\n');
      if (runsBody) {
        endCommand();
        result.push(...commands(body, dialect, depth + 1));
      } else {
        endWord();
        words.push(body);
      }
    }
    return at - 1;
  };
  for (let index = 0; index < line.length; index++) {
    const char = line[index] as string;
    // Past MAX_HEREDOC_DEPTH nested here-documents, << is read as a word, so the lines of the deepest bodies are read as
    // commands of their own: each is still checked, and a nesting of thousands costs neither the stack nor quadratic time.
    if (dialect === 'sh' && depth < MAX_HEREDOC_DEPTH && quoted === undefined && char === '<' && line[index + 1] === '<' && line[index + 2] !== '<') {
      const heredoc = /^<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|([^\s;&|<>()]+))/.exec(line.slice(index, index + 300));
      if (heredoc !== null) {
        endWord();
        pending.push({ delimiter: heredoc[2] ?? heredoc[3] ?? heredoc[4] ?? '', strip: heredoc[1] === '-' });
        index += heredoc[0].length - 1;
        continue;
      }
    }
    if (quoted === undefined && char === '\n' && pending.length > 0) {
      index = readBodies(index);
      endCommand();
      lineStart = index + 1;
      continue;
    }
    if (quoted !== undefined) {
      const next = line[index + 1];
      if (char === quoted && dialect === 'powershell' && next === quoted) {
        // PowerShell writes a quote inside quotes twice: 'it''s', "say ""hi""".
        word += char;
        index++;
      } else if (char === quoted) {
        quoted = undefined;
      } else if (quoted === '"' && dialect === 'sh' && char === '\\' && next !== undefined && SH_QUOTED_ESCAPES.includes(next)) {
        // In bash a backslash escapes only these inside double quotes, and a backslash-newline is removed.
        if (next !== '\n') word += next;
        index++;
      } else if (quoted === '"' && dialect === 'powershell' && char === '`' && next !== undefined) {
        word += next;
        index++;
      } else {
        word += char;
      }
      continue;
    }
    if (char === '"' || (char === "'" && dialect !== 'cmd')) {
      quoted = char;
      started = true;
    } else if (dialect === 'sh' && char === '$' && line[index + 1] === "'") {
      const decoded = ansiC(line, index + 1);
      word += decoded.text;
      index = decoded.end;
      started = true;
    } else if (char === ESCAPE[dialect] && index + 1 < line.length) {
      // An escaped newline continues the line; any other escaped character is part of the word.
      if (line[index + 1] !== '\n') {
        word += line[index + 1];
        started = true;
      }
      index++;
    } else if (char === ';' || char === '\n' || char === '|' || char === '&' || char === '(' || char === ')' || (char === '`' && dialect === 'sh') || ((char === '{' || char === '}') && dialect === 'powershell')) {
      if (char === '\n') lineStart = index + 1;
      endCommand();
      if ((char === '|' || char === '&') && line[index + 1] === char) index++;
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      word += char;
      started = true;
    }
  }
  endCommand();
  return result;
}

// Words that run the rest of the command line as a command of its own.
// Shell words that run the command after them.
const KEYWORDS = new Set(['!', '{', 'if', 'elif', 'while', 'until', 'then', 'do', 'else']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'ash']);
// A here-document read by a shell, directly or through a pipe, holds commands.
const SHELL_CONSUMER = /^(?:sh|bash|zsh|dash|ksh|fish|ash|sudo|env|exec)$/;
const PIPED_TO_SHELL = /\|\s*(?:sudo\s+)?(?:ba|z|da|k|a)?sh(?![\w-])/;
// Programs that run the rest of their arguments as a command: their options that take a value as the next word, and how
// many plain arguments come before the command (timeout DURATION command).
const RUNNERS: Readonly<Record<string, { values: readonly string[]; operands?: number }>> = {
  env: { values: ['-u', '--unset', '-C', '--chdir'] },
  sudo: { values: ['-u', '--user', '-g', '--group', '-C', '--close-from', '-D', '--chdir', '-h', '--host', '-p', '--prompt', '-r', '--role', '-t', '--type', '-T', '--command-timeout', '-U', '--other-user'] },
  doas: { values: ['-u', '-C'] },
  nice: { values: ['-n', '--adjustment'] },
  timeout: { values: ['-s', '--signal', '-k', '--kill-after'], operands: 1 },
  time: { values: ['-f', '--format', '-o', '--output'] },
  exec: { values: ['-a'] },
  command: { values: [] },
  nohup: { values: [] },
  stdbuf: { values: ['-i', '-o', '-e', '--input', '--output', '--error'] },
  ionice: { values: ['-c', '--class', '-n', '--classdata'] },
};
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// pwsh takes any unambiguous start of -Command; -c is documented as its short form.
const PWSH_COMMAND = /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i;
const MAX_DEPTH = 4;

function name(word: string): string {
  return (word.split(/[\\/]/).at(-1) ?? '').toLowerCase().replace(/\.(?:cmd|exe|bat|ps1)$/, '');
}

/**
 * The commands a command line runs once wrappers are taken off: VAR=value, env, sudo, nice, timeout, exec and the like,
 * cmd /c, sh -c, bash -c and pwsh -Command. A wrapped script may hold several commands, so a list is returned: cmd /c
 * npx -y server is read as npx -y server. Wrappers not listed here are not taken off; launch() still finds a launcher
 * after them.
 */
export function unwrapCommand(words: readonly string[], depth = 0): string[][] {
  if (depth > MAX_DEPTH) return [[...words]];
  let index = 0;
  for (;;) {
    const word = words[index];
    if (word === undefined) return [];
    const program = name(word);
    const runner = Object.hasOwn(RUNNERS, program) ? RUNNERS[program] : undefined;
    if (ASSIGNMENT.test(word) || KEYWORDS.has(word)) {
      index++;
    } else if (runner !== undefined) {
      index++;
      let operands = runner.operands ?? 0;
      while (words[index] !== undefined) {
        const option = words[index] as string;
        if (option === '--') {
          index++;
          break;
        }
        if (program === 'env' && (option === '-S' || option === '--split-string')) return unwrapScript([words[index + 1] ?? '', ...words.slice(index + 2)].join(' '), depth);
        if (option.startsWith('-') && option.length > 1) index += runner.values.includes(option) ? 2 : 1;
        else if (program === 'env' && (ASSIGNMENT.test(option) || option === '-')) index++;
        else if (operands > 0) {
          operands--;
          index++;
        } else break;
      }
    } else if (program === 'cmd') {
      const at = words.findIndex((item, position) => position > index && /^\/[ck]$/i.test(item));
      if (at === -1) break;
      // cmd does not escape with backslashes: C:\tools\npx.cmd stays a path.
      return unwrapScript(words.slice(at + 1).join(' '), depth, 'cmd');
    } else if (SHELLS.has(program) || program === 'pwsh' || program === 'powershell') {
      const at = words.findIndex((item, position) => position > index && (SHELLS.has(program) ? /^-[a-z]*c[a-z]*$/ : PWSH_COMMAND).test(item));
      const script = at === -1 ? undefined : words[at + 1] === '--' ? words[at + 2] : words[at + 1];
      if (script === undefined) break;
      return unwrapScript(script, depth, SHELLS.has(program) ? 'sh' : 'powershell');
    } else {
      break;
    }
  }
  return [words.slice(index)];
}

function unwrapScript(script: string, depth: number, dialect: Dialect = 'sh'): string[][] {
  return commands(script, dialect).flatMap((inner) => unwrapCommand(inner, depth + 1));
}
