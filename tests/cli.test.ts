import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXIT_OK, EXIT_USAGE, getVersion, run } from '../src/index.ts';

async function cli(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { code, stdout, stderr };
}

describe('agentcurfew CLI', () => {
  it.each([[[]], [['--help']], [['-h']], [['help']]])('prints help for %j', async (argv) => {
    const { code, stdout, stderr } = await cli(...argv);
    expect(code).toBe(EXIT_OK);
    expect(stderr).toBe('');
    expect(stdout).toContain('Usage: agentcurfew');
    expect(stdout).toContain('acf');
    expect(stdout).toContain('--version');
  });

  it('does not offer commands that do not exist yet as working', async () => {
    const { stdout } = await cli('--help');
    expect(stdout).toMatch(/planned/i);
  });

  it.each([['--version'], ['-v']])('prints the version of package.json for %s', async (flag) => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    const { code, stdout, stderr } = await cli(flag);
    expect(code).toBe(EXIT_OK);
    expect(stderr).toBe('');
    expect(stdout).toBe(`${pkg.version}\n`);
    expect(getVersion()).toBe(pkg.version);
  });

  it('rejects an unknown command, saying what, where and what to do', async () => {
    const { code, stdout, stderr } = await cli('frobnicate');
    expect(code).toBe(EXIT_USAGE);
    expect(stdout).toBe('');
    expect(stderr).toContain('frobnicate');
    expect(stderr).toContain('command line');
    expect(stderr).toContain('agentcurfew --help');
  });

  it('rejects an unknown option the same way', async () => {
    const { code, stderr } = await cli('--frobnicate');
    expect(code).toBe(EXIT_USAGE);
    expect(stderr).toContain('--frobnicate');
    expect(stderr).toContain('agentcurfew --help');
  });

  it('does not echo control characters from the command line', async () => {
    const { stderr } = await cli('\u001b[31mred');
    expect(stderr).not.toContain('\u001b');
  });
});
