import { quote } from '../mask.ts';
import { commandLine, mcpEntry } from '../mcp.ts';
import type { Rule, RuleHit } from '../types.ts';

function program(word: string): string {
  return (word.split(/[\\/]/).at(-1) ?? '').toLowerCase().replace(/\.(?:cmd|exe|bat|ps1)$/, '');
}

// Flags of the launchers that take a value, so that the value is not taken for the package.
const VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  npm: new Set(['-p', '--package', '-c', '--call', '-w', '--workspace', '--registry', '--prefix', '--cache', '--userconfig']),
  uv: new Set(['--from', '-w', '--with', '--with-editable', '--with-requirements', '-p', '--python', '--index', '--index-url', '--extra-index-url', '--default-index', '-c', '--constraints', '--directory', '--project', '--cache-dir']),
  pipx: new Set(['--spec', '--python', '--index-url', '--pip-args']),
  docker: new Set(['-e', '--env', '--env-file', '-v', '--volume', '--mount', '-p', '--publish', '--name', '-w', '--workdir', '-u', '--user', '--network', '--net', '--entrypoint', '-l', '--label', '--platform', '--pull', '-h', '--hostname', '--add-host', '--cpus', '-m', '--memory', '--device', '--cap-add', '--cap-drop', '--security-opt', '--runtime', '--ulimit', '--tmpfs', '--log-driver', '--log-opt', '--restart', '--gpus', '--ipc', '--pid', '--shm-size', '--stop-signal', '--dns', '--group-add', '--expose']),
};

interface Launch {
  family: 'npm' | 'uv' | 'pipx' | 'docker';
  /** The package or image as written, or undefined when it could not be found. */
  spec?: string;
}

function findSpec(words: readonly string[], from: number, family: Launch['family']): { spec?: string | undefined; explicit?: string | undefined } {
  const flags = VALUE_FLAGS[family] as ReadonlySet<string>;
  let explicit: string | undefined;
  for (let index = from; index < words.length; index++) {
    const word = words[index] as string;
    if (word === '--') return { spec: words[index + 1], explicit };
    if (word.startsWith('-')) {
      const [flag, inline] = word.split('=', 2) as [string, string | undefined];
      const value = inline ?? (flags.has(flag) ? words[++index] : undefined);
      if ((flag === '-p' || flag === '--package') && family === 'npm' && value !== undefined) explicit = value;
      if ((flag === '--from' && family === 'uv') || (flag === '--spec' && family === 'pipx')) explicit = value;
      continue;
    }
    return { spec: word, explicit };
  }
  return { explicit };
}

/** How the server is started, when it is a launcher that fetches a package or image at run time. */
function launch(words: readonly string[]): Launch | undefined {
  const name = program(words[0] ?? '');
  const sub = words[1];
  let family: Launch['family'] | undefined;
  let from = 1;
  if (name === 'npx' || name === 'bunx' || name === 'pnpx') family = 'npm';
  else if ((name === 'npm' && sub === 'exec') || (name === 'pnpm' && sub === 'dlx') || (name === 'yarn' && sub === 'dlx') || (name === 'bun' && sub === 'x')) [family, from] = ['npm', 2];
  else if (name === 'uvx') family = 'uv';
  else if (name === 'uv' && sub === 'tool' && words[2] === 'run') [family, from] = ['uv', 3];
  else if (name === 'pipx' && sub === 'run') [family, from] = ['pipx', 2];
  else if ((name === 'docker' || name === 'podman') && sub === 'run') [family, from] = ['docker', 2];
  else if ((name === 'docker' || name === 'podman') && sub === 'container' && words[2] === 'run') [family, from] = ['docker', 3];
  if (family === undefined) return undefined;
  const { spec, explicit } = findSpec(words, from, family);
  const chosen = explicit ?? spec;
  return chosen === undefined ? { family } : { family, spec: chosen };
}

const EXACT = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function npmProblem(spec: string): string | undefined {
  if (/^(?:\.{0,2}\/|[A-Za-z]:[\\/]|file:)/.test(spec)) return undefined;
  if (/^(?:git\+|git:|github:|gitlab:|bitbucket:|https?:)/.test(spec) || /^[\w.-]+\/[\w.-]+(?:#.*)?$/.test(spec)) {
    return /#[0-9a-f]{40}$/.test(spec) ? undefined : 'comes from a URL or a git repository without a commit hash';
  }
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
  if (at === -1) return 'has no version, so every start may fetch a newer one';
  const version = spec.slice(at + 1);
  if (EXACT.test(version)) return undefined;
  return `asks for "${quote(version, 30)}", which is not an exact version`;
}

function pythonProblem(spec: string): string | undefined {
  if (/^(?:\.{0,2}\/|[A-Za-z]:[\\/]|file:)/.test(spec)) return undefined;
  if (/^(?:git\+|https?:)/.test(spec)) return /@[0-9a-f]{40}(?:#.*)?$/.test(spec) ? undefined : 'comes from a URL or a git repository without a commit hash';
  const exact = /^[A-Za-z0-9][\w.-]*(?:\[[^\]]*\])?\s*(?:==|@)\s*v?\d+(?:\.\d+)*(?:[a-z]+\d*)?$/i;
  if (exact.test(spec) && !/@latest$/i.test(spec)) return undefined;
  if (/[<>~!=]=?|@latest$/i.test(spec)) return 'asks for a range or for latest, not an exact version';
  return 'has no version, so every start may fetch a newer one';
}

function dockerProblem(image: string): string | undefined {
  if (/@sha256:[0-9a-f]{64}$/.test(image)) return undefined;
  const tag = /:([^/:@]+)$/.exec(image)?.[1];
  if (tag === undefined || tag === 'latest') return 'uses no tag or latest, and no digest';
  return `uses the tag "${quote(tag, 30)}", which can be moved to another image; only a digest is fixed`;
}

export const unpinnedMcpServer: Rule = {
  id: 'unpinned-mcp-server',
  title: 'MCP server without a fixed version',
  level: 'medium',
  owasp: ['AST02', 'AST07'],
  description:
    'Finds MCP servers started through a launcher that downloads them at run time (npx, bunx, pnpm dlx, yarn dlx, npm exec, uvx, uv tool run, pipx run, docker run, podman run) without an exact version or an image digest. Each start may then run code that nobody reviewed, and the lockfile cannot pin it.',
  fix: 'Pin an exact version (npx -y package@1.2.3, uvx package==1.2.3) or an image digest (image@sha256:...). Check the package itself with depcurfew: npx depcurfew check <package>.',
  example: '"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"]',
  kinds: ['mcp-server'],
  check(component, context) {
    const entry = mcpEntry(component, context.knowledge);
    if (entry === undefined) return [];
    const started = launch(commandLine(entry));
    if (started === undefined) return [];
    if (started.spec === undefined) return [{ message: `starts with ${started.family === 'docker' ? 'a container' : 'a package'} launcher, but the package could not be found in its arguments` , level: 'low' }];
    const problem = started.family === 'docker' ? dockerProblem(started.spec) : started.family === 'npm' ? npmProblem(started.spec) : pythonProblem(started.spec);
    if (problem === undefined) return [];
    const what = started.family === 'docker' ? 'the image' : 'the package';
    const check = started.family !== 'npm' ? '' : `; check it with npx depcurfew check ${quote(started.spec, 80)}`;
    const hit: RuleHit = { message: `${what} ${quote(started.spec, 80)} ${problem}${check}` };
    return [hit];
  },
};
