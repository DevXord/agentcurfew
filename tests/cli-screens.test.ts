import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/cli/commands.ts';
import { run } from '../src/index.ts';
import { materialize } from './rules/materialize.ts';

const repo = (name: string) => fileURLToPath(new URL(`fixtures/repos/${name}`, import.meta.url));

async function screen(argv: readonly string[], options: { color?: boolean; root?: string } = {}): Promise<string> {
  let stdout = '';
  let stderr = '';
  const code = await run([...argv], { stdout: (text) => (stdout += text), stderr: (text) => (stderr += text), ...(options.color === undefined ? {} : { color: options.color }) });
  const text = `$ agentcurfew ${argv.join(' ')}\n[exit ${code}]\n${stdout}${stderr === '' ? '' : `[stderr]\n${stderr}`}`;
  return options.root === undefined ? text : text.replaceAll(options.root, '<project>');
}

async function onFixture(path: string, argv: readonly string[], prepare?: (root: string) => void): Promise<string> {
  const { root, cleanup } = materialize(path);
  try {
    prepare?.(root);
    return await screen([...argv, root], { root });
  } finally {
    cleanup();
  }
}

describe('screens', () => {
  it('welcome and help', async () => {
    expect(await screen([])).toMatchSnapshot();
    expect(await screen(['help'])).toMatchSnapshot();
  });

  it.each(COMMANDS.map((command) => command.name))('help of %s', async (name) => {
    expect(await screen([name, '--help'])).toMatchSnapshot();
  });

  it('scan', async () => {
    expect(await onFixture('hidden-unicode/positive', ['scan'])).toMatchSnapshot();
    expect(await onFixture('secret-in-config/positive', ['scan'])).toMatchSnapshot();
    expect(await onFixture('out-of-policy/positive', ['scan', '--fail-on', 'none'])).toMatchSnapshot();
    expect(await screen(['scan', repo('claude-basic'), '--inventory'], { root: repo('claude-basic') })).toMatchSnapshot();
  });

  it('lock, verify and drift', async () => {
    expect(await onFixture('drift/positive', ['verify'])).toMatchSnapshot();
    expect(await onFixture('drift/negative', ['verify'])).toMatchSnapshot();
    expect(await onFixture('skills-lock-mismatch/positive', ['lock'])).toMatchSnapshot();
  });

  it('doctor and init', async () => {
    const base = fileURLToPath(new URL('fixtures/doctor/deprecated-format/positive', import.meta.url));
    expect(await screen(['doctor', base], { root: base })).toMatchSnapshot();
    expect(await screen(['init', repo('claude-basic'), '--print'], { root: repo('claude-basic') })).toMatchSnapshot();
  });

  it('explain', async () => {
    expect(await screen(['explain', 'hidden-unicode'])).toMatchSnapshot();
  });

  it('errors with a suggestion', async () => {
    expect(await screen(['scna'])).toMatchSnapshot();
    expect(await screen(['scan', '--jsn'])).toMatchSnapshot();
    expect(await screen(['explain', 'hiden-unicode'])).toMatchSnapshot();
  });

  it('colors only labels, and only when asked', async () => {
    const { root, cleanup } = materialize('hidden-unicode/positive');
    try {
      const plain = await screen(['scan', root]);
      const colored = await screen(['scan', root], { color: true });
      expect(plain).not.toContain('\u001b[');
      expect(colored).toContain('\u001b[1m\u001b[31mCRITICAL\u001b[39m\u001b[22m');
      expect(colored.replace(/\u001b\[\d+m/g, '')).toBe(plain);
    } finally {
      cleanup();
    }
  });
});

describe('errors', () => {
  it('say what, where and what to do', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'acf-errors-'));
    try {
      writeFileSync(join(empty, 'agentcurfew.policy.json'), '{"version":2}');
      const cases: string[][] = [
        ['frobnicate'],
        ['--frobnicate'],
        ['scan', '--jsn'],
        ['scan', '--fail-on', 'severe'],
        ['scan', 'a', 'b'],
        ['scan', join(empty, 'missing')],
        ['scan', empty],
        ['verify', repo('empty')],
        ['explain'],
        ['explain', 'nope'],
        ['help', 'nope'],
        ['doctor', '--fail-on', 'high'],
        ['init', repo('empty'), '--bogus'],
      ];
      for (const argv of cases) {
        let stderr = '';
        const code = await run(argv, { stdout: () => undefined, stderr: (text) => (stderr += text) });
        expect(code, argv.join(' ')).not.toBe(0);
        expect(stderr, argv.join(' ')).toMatch(/^agentcurfew: .+\n {2}in: .+\n {2}fix: .+\n$/);
      }
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
