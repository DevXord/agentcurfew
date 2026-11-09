import { commands } from '../command-words.ts';
import { launch, pinProblem } from '../launch.ts';
import { quote } from '../mask.ts';
import { at, entryValue, texts } from '../text.ts';
import type { Rule, RuleHit } from '../types.ts';

/** Every string of an entry, and every list of strings joined as one command line (command with args). */
function commandLines(value: unknown, depth = 0): string[] {
  if (depth > 32) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => commandLines(item, depth + 1));
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  // A hook with args runs command with those words, without a shell: one command line, not two.
  const { command, args } = record;
  const withArgs = typeof command === 'string' && Array.isArray(args) && args.every((word) => typeof word === 'string');
  const lines = Object.entries(record).flatMap(([key, item]) => (withArgs && (key === 'command' || key === 'args') ? [] : commandLines(item, depth + 1)));
  if (withArgs) lines.push([command, ...(args as string[])].join(' '));
  return lines;
}

export const unpinnedLauncher: Rule = {
  id: 'unpinned-launcher',
  title: 'Command fetches a package without a fixed version',
  level: 'medium',
  owasp: ['AST02', 'AST07'],
  description:
    'Finds hooks, automatic tasks and settings that run a command (statusLine, apiKeyHelper and the like), and the scripts of the project they run, whose command starts a package through a launcher that downloads it at run time (npx, bunx, pnpm dlx, yarn dlx, npm exec and npm x, uvx, uv tool run, pipx run, docker run, podman run, also after their global options), and every package it fetches (each -p, uvx --with), that has no exact version or image digest. The hook then runs whatever version is newest when its event fires, with the user\'s rights and without a prompt, and the lockfile cannot pin it.',
  levels: 'low when the package could not be found in the launcher arguments',
  fix: 'Pin an exact version (npx -y package@1.2.3, uvx package==1.2.3) or an image digest (image@sha256:...), or install the package as a dependency of the project and run it from there (npx --no-install package, ./node_modules/.bin/package). Check the package itself with depcurfew: npx depcurfew check <package>.',
  falsePositives: 'npx runs a package the project has installed without downloading it, so a dependency of the project pinned in its lockfile is reported too; npx --no-install says so explicitly.',
  example: '"command": "npx prettier --write ."',
  kinds: ['hook', 'auto-run', 'command-setting'],
  check(component) {
    const value = entryValue(component);
    // The entry's own command lines, and the scripts of the project it runs, with their paths.
    const sources: { text: string; inFile?: string; whole: boolean }[] = value === undefined ? texts(component) : [...commandLines(value).map((text) => ({ text, whole: false })), ...texts(component).filter((source) => source.inFile !== undefined)];
    const hits: RuleHit[] = [];
    const seen = new Set<string>();
    for (const source of sources) {
      // Places are found by searching on from the last one, so the text is read once; once a word cannot be found as
      // written (quoting changes it), later hits get no place rather than a search from the start each time.
      let cursor: number | undefined = 0;
      for (const words of commands(source.text)) {
        const started = launch(words);
        if (started === undefined || started.noDownload === true) continue;
        const anchor = started.spec ?? words[0] ?? '';
        const found: number = cursor === undefined ? -1 : source.text.indexOf(anchor, cursor);
        cursor = found === -1 ? undefined : found + anchor.length;
        const place = found !== -1 ? at(source, found) : source.inFile === undefined ? {} : { inFile: source.inFile };
        const what = started.family === 'docker' ? 'the image' : 'the package';
        const fetched = started.packages ?? (started.spec === undefined ? [] : [started.spec]);
        const launched: RuleHit[] = [];
        if (fetched.length === 0) {
          launched.push({ message: `the command starts ${started.family === 'docker' ? 'a container' : 'a package'} launcher, but the package could not be found in its arguments`, level: 'low' });
        }
        for (const spec of fetched) {
          const problem = pinProblem(started.family, spec);
          if (problem === undefined) continue;
          const check = started.family !== 'npm' ? '' : `; check it with npx depcurfew check ${quote(spec, 80)}`;
          launched.push({ message: `the command runs ${what} ${quote(spec, 80)}, which ${problem}${check}` });
        }
        for (const hit of launched) {
          if (seen.has(hit.message)) continue;
          seen.add(hit.message);
          hits.push({ ...hit, ...place });
        }
      }
    }
    return hits;
  },
};
