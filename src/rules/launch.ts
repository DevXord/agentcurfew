// How an MCP server is started, read from its command line only: nothing is run or resolved.

import { unwrapCommand } from './command-words.ts';

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

export interface Launch {
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

/**
 * How the server is started, when it is a launcher that fetches a package or image at run time. Wrappers are looked
 * through: cmd /c npx -y server, sh -c "npx -y server" and env X=1 npx -y server start npx.
 */
export function launch(words: readonly string[]): Launch | undefined {
  for (const inner of unwrapCommand(words)) {
    const started = launchOne(inner);
    if (started !== undefined) return started;
  }
  return undefined;
}

function launchOne(words: readonly string[]): Launch | undefined {
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

export interface PackageRef {
  ecosystem: 'npm' | 'pypi' | 'oci';
  name: string;
  /** The version, tag or digest as written; null when none is given. */
  version: string | null;
}

/** The package or image a launcher fetches, split into name and version as the launcher's syntax writes them. */
export function packageRef(started: Launch): PackageRef | undefined {
  const spec = started.spec;
  if (spec === undefined || /^(?:\.{0,2}\/|[A-Za-z]:[\\/]|file:|git\+|git:|github:|https?:)/.test(spec)) return undefined;
  if (started.family === 'docker') {
    const digest = /^(.+)@(sha256:[0-9a-f]{64})$/.exec(spec);
    if (digest !== null) return { ecosystem: 'oci', name: digest[1] as string, version: digest[2] as string };
    const tag = /^(.+):([^/:@]+)$/.exec(spec);
    return tag === null ? { ecosystem: 'oci', name: spec, version: null } : { ecosystem: 'oci', name: tag[1] as string, version: tag[2] as string };
  }
  if (started.family === 'npm') {
    const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
    return at === -1 ? { ecosystem: 'npm', name: spec, version: null } : { ecosystem: 'npm', name: spec.slice(0, at), version: spec.slice(at + 1) };
  }
  const python = /^([A-Za-z0-9][\w.-]*(?:\[[^\]]*\])?)\s*(?:==|@)\s*(.+)$/.exec(spec);
  return python === null ? { ecosystem: 'pypi', name: spec, version: null } : { ecosystem: 'pypi', name: python[1] as string, version: python[2] as string };
}
