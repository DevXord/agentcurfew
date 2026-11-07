// Command lines read as words: nothing is run, expanded or resolved.

/**
 * Words of one simple command, with quotes removed; commands are split on ;, &&, ||, |, newlines, parentheses and
 * backquotes outside quotes, so that (cmd), $(cmd) and `cmd` are commands of their own.
 */
export function commands(line: string): string[][] {
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
  for (let index = 0; index < line.length; index++) {
    const char = line[index] as string;
    if (quoted !== undefined) {
      if (char === quoted) quoted = undefined;
      else if (char === '\\' && quoted === '"' && index + 1 < line.length) word += line[++index];
      else word += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quoted = char;
      started = true;
    } else if (char === '\\' && index + 1 < line.length) {
      word += line[++index];
      started = true;
    } else if (char === ';' || char === '\n' || char === '|' || char === '&' || char === '(' || char === ')' || char === '`') {
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
const PREFIXES = new Set(['exec', 'command', 'nohup', 'time', 'nice', '!', '{', 'then', 'do', 'else']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'ash']);
const SUDO_VALUES = new Set(['-u', '--user', '-g', '--group', '-C', '--close-from', '-D', '--chdir', '-h', '--host', '-p', '--prompt', '-r', '--role', '-t', '--type', '-T', '--command-timeout', '-U', '--other-user']);
const ENV_VALUES = new Set(['-u', '--unset', '-C', '--chdir']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const MAX_DEPTH = 4;

function name(word: string): string {
  return (word.split(/[\\/]/).at(-1) ?? '').toLowerCase().replace(/\.(?:cmd|exe|bat|ps1)$/, '');
}

/**
 * The commands a command line runs once wrappers are taken off: VAR=value, env, sudo, exec and the like, cmd /c,
 * sh -c, bash -c and pwsh -Command. A wrapped script may hold several commands, so a list is returned. A wrapper
 * hides nothing from a check this way: cmd /c npx -y server is read as npx -y server.
 */
export function unwrapCommand(words: readonly string[], depth = 0): string[][] {
  if (depth > MAX_DEPTH) return [[...words]];
  let index = 0;
  for (;;) {
    const word = words[index];
    if (word === undefined) return [];
    const program = name(word);
    if (ASSIGNMENT.test(word) || PREFIXES.has(word)) {
      index++;
    } else if (program === 'env') {
      index++;
      while (words[index] !== undefined && ((words[index] as string).startsWith('-') || ASSIGNMENT.test(words[index] as string))) {
        const option = words[index] as string;
        if (option === '-S' || option === '--split-string') return unwrapScript([words[index + 1] ?? '', ...words.slice(index + 2)].join(' '), depth);
        index += ENV_VALUES.has(option) ? 2 : 1;
      }
    } else if (program === 'sudo' || program === 'doas') {
      index++;
      while (words[index]?.startsWith('-') === true) index += SUDO_VALUES.has(words[index] as string) ? 2 : 1;
    } else if (program === 'cmd') {
      const at = words.findIndex((item, position) => position > index && /^\/[ck]$/i.test(item));
      if (at === -1) break;
      return unwrapScript(words.slice(at + 1).join(' '), depth);
    } else if (SHELLS.has(program) || program === 'pwsh' || program === 'powershell') {
      const at = words.findIndex((item, position) => position > index && (SHELLS.has(program) ? /^-[a-z]*c[a-z]*$/ : /^-(?:c|command)$/i).test(item));
      const script = at === -1 ? undefined : words[at + 1];
      if (script === undefined) break;
      return unwrapScript(script, depth);
    } else {
      break;
    }
  }
  return [words.slice(index)];
}

function unwrapScript(script: string, depth: number): string[][] {
  return commands(script).flatMap((inner) => unwrapCommand(inner, depth + 1));
}
