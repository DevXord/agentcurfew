// How an MCP server is started, read from its command line only: nothing is run or resolved.

import { unwrapCommand } from './command-words.ts';
import { quote } from './mask.ts';

function program(word: string): string {
  return (word.split(/[\\/]/).at(-1) ?? '').toLowerCase().replace(/\.(?:cmd|exe|bat|ps1)$/, '');
}

// Flags of the launchers that take a value, so that the value is not taken for the package. Global options of the
// program, which may come before its subcommand (npm --prefix x exec, docker --context x run), are in the same sets.
const VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  npm: new Set(['-p', '--package', '-c', '--call', '-w', '--workspace', '--registry', '--prefix', '--cache', '--userconfig', '--globalconfig', '--node-options', '--script-shell', '--loglevel', '--before', '--tag', '--otp', '--dir', '-C', '--cwd', '--filter', '-F']),
  uv: new Set(['--from', '-w', '--with', '--with-editable', '--with-requirements', '-p', '--python', '--index', '--index-url', '--extra-index-url', '--default-index', '-c', '--constraints', '--directory', '--project', '--cache-dir', '--config-file']),
  pipx: new Set(['--spec', '--python', '--index-url', '--pip-args']),
  docker: new Set([
    '-e', '--env', '--env-file', '-v', '--volume', '--mount', '-p', '--publish', '--name', '-w', '--workdir', '-u', '--user', '--network', '--net', '--entrypoint', '-l', '--label', '--label-file', '--platform', '--pull',
    '-h', '--hostname', '--add-host', '--cpus', '-m', '--memory', '--memory-swap', '--memory-reservation', '--device', '--cap-add', '--cap-drop', '--security-opt', '--runtime', '--ulimit', '--tmpfs', '--log-driver', '--log-opt',
    '--restart', '--gpus', '--ipc', '--pid', '--shm-size', '--stop-signal', '--stop-timeout', '--dns', '--dns-option', '--dns-search', '--domainname', '--group-add', '--expose', '--cidfile', '--cgroup-parent', '--cgroupns',
    '--volumes-from', '--health-cmd', '--health-interval', '--health-retries', '--health-timeout', '--health-start-period', '--ip', '--ip6', '--mac-address', '--storage-opt', '--sysctl', '--uts', '--userns', '-a', '--attach',
    '--network-alias', '--cpuset-cpus', '--cpuset-mems', '-c', '--cpu-shares', '--cpu-period', '--cpu-quota', '--blkio-weight', '--device-read-bps', '--device-write-bps', '--isolation', '--link', '--pids-limit', '--oom-score-adj',
    '--annotation', '--context', '--host', '-H', '--config', '--log-level', '--tlscacert', '--tlscert', '--tlskey',
  ]),
};

export interface Launch {
  family: 'npm' | 'uv' | 'pipx' | 'docker';
  /** The package or image as written, or undefined when it could not be found. */
  spec?: string;
  /** Every package the launcher fetches, when it names more than one (npx -p a -p b, uvx --with a b); spec is among them. */
  packages?: string[];
  /** An npm launcher told before the package to run only what is installed (--no-install, --no): nothing is downloaded. */
  noDownload?: true;
}

// npm options that keep a launcher from downloading: npx --no-install, npm exec --no.
const NO_DOWNLOAD = new Set(['--no-install', '--no']);

function findSpec(words: readonly string[], from: number, family: Launch['family']): { spec?: string; explicit: string[]; extra: string[]; noDownload: boolean } {
  const flags = VALUE_FLAGS[family] as ReadonlySet<string>;
  const explicit: string[] = [];
  const extra: string[] = [];
  let noDownload = false;
  for (let index = from; index < words.length; index++) {
    const word = words[index] as string;
    if (word === '--') {
      const spec = words[index + 1];
      return spec === undefined ? { explicit, extra, noDownload } : { spec, explicit, extra, noDownload };
    }
    if (word.startsWith('-')) {
      const [flag, inline] = word.split('=', 2) as [string, string | undefined];
      const value = inline ?? (flags.has(flag) ? words[++index] : undefined);
      if (family === 'npm' && NO_DOWNLOAD.has(flag) && inline === undefined) noDownload = true;
      if (value === undefined) continue;
      if (((flag === '-p' || flag === '--package') && family === 'npm') || (flag === '--from' && family === 'uv') || (flag === '--spec' && family === 'pipx')) explicit.push(value);
      if ((flag === '--with' || flag === '-w') && family === 'uv') extra.push(value);
      continue;
    }
    return { spec: word, explicit, extra, noDownload };
  }
  return { explicit, extra, noDownload };
}

/**
 * How the server is started, when it is a launcher that fetches a package or image at run time. Wrappers are looked
 * through: cmd /c npx -y server, sh -c "npx -y server" and env X=1 npx -y server start npx.
 */
export function launch(words: readonly string[]): Launch | undefined {
  for (const inner of unwrapCommand(words)) {
    const started = launchOne(inner);
    if (started !== undefined) return started;
    // A wrapper agentcurfew does not know, such as chpst or a script of its own, may still pass its arguments to a
    // launcher: read from the first launcher word on, so that the server is not taken for a local command.
    // At most 32 tries: each reads the rest of the words, and a padded command must not cost quadratic time.
    let tries = 0;
    for (let index = 1; index < inner.length && tries < 32; index++) {
      if (!LAUNCHERS.has(program(inner[index] ?? ''))) continue;
      tries++;
      const later = launchOne(inner.slice(index));
      if (later !== undefined) return later;
    }
  }
  return undefined;
}

const LAUNCHERS = new Set(['npx', 'bunx', 'pnpx', 'npm', 'pnpm', 'yarn', 'bun', 'uvx', 'uv', 'pipx', 'docker', 'podman']);

// Subcommands that fetch and run, by program; npm's x and exe are its own aliases of exec.
const SUBCOMMANDS: Readonly<Record<string, { family: Launch['family']; words: readonly (readonly string[])[] }>> = {
  npm: { family: 'npm', words: [['exec'], ['x'], ['exe']] },
  pnpm: { family: 'npm', words: [['dlx']] },
  yarn: { family: 'npm', words: [['dlx']] },
  bun: { family: 'npm', words: [['x']] },
  uv: { family: 'uv', words: [['tool', 'run']] },
  pipx: { family: 'pipx', words: [['run']] },
  docker: { family: 'docker', words: [['run'], ['container', 'run']] },
  podman: { family: 'docker', words: [['run'], ['container', 'run']] },
};

/** The index of the first word after the program's global options, skipping the values of options that take one. */
function subcommandIndex(words: readonly string[], family: Launch['family']): number {
  const flags = VALUE_FLAGS[family] as ReadonlySet<string>;
  let index = 1;
  while (index < words.length) {
    const word = words[index] as string;
    if (!word.startsWith('-') || word === '--') return index;
    index += !word.includes('=') && flags.has(word) ? 2 : 1;
  }
  return index;
}

function launchOne(words: readonly string[]): Launch | undefined {
  const name = program(words[0] ?? '');
  let family: Launch['family'] | undefined;
  // The words to read options and the package from: those before the subcommand, which are the program's own options
  // (npm --package=x exec y), and those after it.
  let rest: readonly string[] = [];
  if (name === 'npx' || name === 'bunx' || name === 'pnpx') [family, rest] = ['npm', words.slice(1)];
  else if (name === 'uvx') [family, rest] = ['uv', words.slice(1)];
  else {
    const known = Object.hasOwn(SUBCOMMANDS, name) ? SUBCOMMANDS[name] : undefined;
    if (known === undefined) return undefined;
    const at = subcommandIndex(words, known.family);
    const sub = known.words.find((parts) => parts.every((part, offset) => words[at + offset] === part));
    if (sub === undefined) return undefined;
    [family, rest] = [known.family, [...words.slice(1, at), ...words.slice(at + sub.length)]];
  }
  const { spec, explicit, extra, noDownload } = findSpec(rest, 0, family);
  const chosen = explicit.at(-1) ?? spec;
  const packages = [...(explicit.length > 0 ? explicit : spec === undefined ? [] : [spec]), ...extra];
  const started: Launch = chosen === undefined ? { family } : { family, spec: chosen };
  if (packages.length > 1) started.packages = packages;
  if (noDownload) started.noDownload = true;
  return started;
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

// Whether a package or image is pinned, as unpinned-mcp-server and unpinned-launcher judge it.

const EXACT = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function npmProblem(spec: string): string | undefined {
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

export function pythonProblem(spec: string): string | undefined {
  if (/^(?:\.{0,2}\/|[A-Za-z]:[\\/]|file:)/.test(spec)) return undefined;
  if (/^(?:git\+|https?:)/.test(spec)) return /@[0-9a-f]{40}(?:#.*)?$/.test(spec) ? undefined : 'comes from a URL or a git repository without a commit hash';
  const exact = /^[A-Za-z0-9][\w.-]*(?:\[[^\]]*\])?\s*(?:==|@)\s*v?\d+(?:\.\d+)*(?:[a-z]+\d*)?$/i;
  if (exact.test(spec) && !/@latest$/i.test(spec)) return undefined;
  if (/[<>~!=]=?|@latest$/i.test(spec)) return 'asks for a range or for latest, not an exact version';
  return 'has no version, so every start may fetch a newer one';
}

export function dockerProblem(image: string): string | undefined {
  if (/@sha256:[0-9a-f]{64}$/.test(image)) return undefined;
  const tag = /:([^/:@]+)$/.exec(image)?.[1];
  if (tag === undefined || tag === 'latest') return 'uses no tag or latest, and no digest';
  return `uses the tag "${quote(tag, 30)}", which can be moved to another image; only a digest is fixed`;
}

/** Why what a launcher fetches is not pinned, or undefined when it is pinned or a local path. */
export function pinProblem(family: Launch['family'], spec: string): string | undefined {
  if (family === 'docker') return dockerProblem(spec);
  return family === 'npm' ? npmProblem(spec) : pythonProblem(spec);
}
