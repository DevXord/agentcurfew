import { commands, unwrapCommand } from './command-words.ts';

/** Programs that run the file named by their first operand, such as python3 hooks/check.py. */
const INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'python', 'python2', 'python3', 'node', 'nodejs', 'ruby', 'perl', 'php', 'lua', 'pwsh', 'powershell', 'tsx', 'ts-node', 'deno', 'bun']);

/** Words some interpreters take before the file: deno run x.ts, bun run x.ts. */
const SUBCOMMANDS: Readonly<Record<string, readonly string[]>> = { deno: ['run'], bun: ['run'] };

/** Options after which the next word is code or a module, not a file: python -c, node -e, python -m, pwsh -Command. */
const INLINE = new Set(['-c', '-e', '-m', '-p', '--eval', '--print', '-command', '-encodedcommand', '-ec']);

/** Options whose value is the file: pwsh -File x.ps1. */
const FILE_OPTIONS = new Set(['-file', '-f']);

/** The longest path, file name and depth of a script that is read: about the limits of common file systems. */
const MAX_PATH_LENGTH = 4096;
const MAX_NAME_LENGTH = 255;
const MAX_SEGMENTS = 64;

function program(word: string): string {
  return (word.split(/[\\/]/).at(-1) ?? word).toLowerCase().replace(/\.exe$/, '');
}

/**
 * The word as a path relative to the project, or undefined when it cannot name a file of the project: an absolute or
 * home path, a drive letter, an address, a variable other than the project's own, a pattern, or a way out through ..
 */
function projectPath(word: string, variables: readonly string[]): string | undefined {
  let path = word;
  for (const variable of variables) {
    for (const prefix of [`$${variable}/`, `\${${variable}}/`]) if (path.startsWith(prefix)) path = path.slice(prefix.length);
  }
  if (/[$`*?[\]{}]/.test(path) || /^[/\\~]/.test(path) || /^[A-Za-z]:/.test(path) || path.includes('://')) return undefined;
  // No file system holds a longer path or name, and the .gitignore match must not be padded (review of 2026-11-09).
  if (path.length > MAX_PATH_LENGTH) return undefined;
  const kept: string[] = [];
  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (segment.length > MAX_NAME_LENGTH || kept.length >= MAX_SEGMENTS) return undefined;
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (kept.pop() === undefined) return undefined;
      continue;
    }
    kept.push(segment);
  }
  return kept.length === 0 ? undefined : kept.join('/');
}

/** The file one simple command runs, as written: its own path, or the operand of an interpreter. */
function scriptWord(words: readonly string[]): { word: string; direct: boolean } | undefined {
  const [first, ...rest] = words;
  if (first === undefined) return undefined;
  const name = program(first);
  if (!INTERPRETERS.has(name)) return { word: first, direct: true };
  let index = 0;
  if ((SUBCOMMANDS[name] ?? []).includes(rest[0] ?? '')) index++;
  for (; index < rest.length; index++) {
    const word = rest[index] as string;
    const option = word.toLowerCase();
    if (INLINE.has(option)) return undefined;
    if (FILE_OPTIONS.has(option) && (name === 'pwsh' || name === 'powershell')) return rest[index + 1] === undefined ? undefined : { word: rest[index + 1] as string, direct: false };
    if (word === '-' || word === '--') continue;
    if (!word.startsWith('-')) return { word, direct: false };
  }
  return undefined;
}

/**
 * Files of the project that a command line runs, relative to the project root: scripts started by their path
 * (./scripts/lint.sh, "$CLAUDE_PROJECT_DIR"/.claude/hooks/x.sh) and scripts given to an interpreter (python3 x.py), also
 * inside sh -c, env, sudo and the other wrappers that unwrapCommand takes off. A bare name is looked up on PATH, so it is
 * not a file of the project. Nothing is run or resolved on disk: the caller decides which of these exist.
 */
export function scriptPaths(line: string, projectVariables: readonly string[]): string[] {
  const found = new Set<string>();
  for (const words of commands(line)) {
    for (const command of unwrapCommand(words)) {
      const script = scriptWord(command);
      if (script === undefined) continue;
      // A program named without a folder is looked up on PATH.
      const stripped = projectVariables.reduce((word, variable) => word.replace(`$${variable}/`, '').replace(`\${${variable}}/`, ''), script.word);
      if (script.direct && !/[\\/]/.test(stripped) && stripped === script.word) continue;
      const path = projectPath(script.word, projectVariables);
      if (path !== undefined) found.add(path);
    }
  }
  return [...found];
}
