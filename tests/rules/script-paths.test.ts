import { describe, expect, it } from 'vitest';
import { scriptPaths } from '../../src/rules/script-paths.ts';

const paths = (line: string) => scriptPaths(line, ['CLAUDE_PROJECT_DIR']);

describe('scriptPaths', () => {
  it('finds a script run directly or by an interpreter', () => {
    expect(paths('./scripts/lint.sh')).toEqual(['scripts/lint.sh']);
    expect(paths('.claude/hooks/check.sh --fast')).toEqual(['.claude/hooks/check.sh']);
    expect(paths('python3 -u .claude/hooks/check.py')).toEqual(['.claude/hooks/check.py']);
    expect(paths('node tools/hook.mjs arg')).toEqual(['tools/hook.mjs']);
    expect(paths('bash scripts/a.sh')).toEqual(['scripts/a.sh']);
    expect(paths('deno run --allow-read hooks/x.ts')).toEqual(['hooks/x.ts']);
    expect(paths('bun run hooks/x.ts')).toEqual(['hooks/x.ts']);
    expect(paths('pwsh -File scripts/x.ps1')).toEqual(['scripts/x.ps1']);
    expect(paths('python3 notify.py')).toEqual(['notify.py']);
  });

  it('strips the project directory variable, quoted or braced', () => {
    expect(paths('python "$CLAUDE_PROJECT_DIR"/.claude/hooks/x.py')).toEqual(['.claude/hooks/x.py']);
    expect(paths('${CLAUDE_PROJECT_DIR}/.claude/hooks/x.sh')).toEqual(['.claude/hooks/x.sh']);
  });

  it('looks inside shell wrappers, chains and environment prefixes', () => {
    expect(paths("bash -c './a.sh && node b.js'")).toEqual(['a.sh', 'b.js']);
    expect(paths('FOO=1 ./run.sh; sh ./y.sh')).toEqual(['run.sh', 'y.sh']);
    expect(paths('env A=1 python3 .claude/h.py')).toEqual(['.claude/h.py']);
  });

  it('leaves out what cannot be a file of the project', () => {
    expect(paths('/usr/local/bin/tool')).toEqual([]);
    expect(paths('~/.claude/statusline.sh')).toEqual([]);
    expect(paths('../outside.sh')).toEqual([]);
    expect(paths('scripts/../../outside.sh')).toEqual([]);
    expect(paths('$HOME/x.sh')).toEqual([]);
    expect(paths('C:/tools/x.ps1')).toEqual([]);
    expect(paths('python -c "print(1)"')).toEqual([]);
    expect(paths('python -m tool.check')).toEqual([]);
    expect(paths('npx prettier --write x.ts')).toEqual([]);
    expect(paths('echo done')).toEqual([]);
    expect(paths('git status')).toEqual([]);
    // A bare name is looked up on PATH, not in the project.
    expect(paths('notify.py')).toEqual([]);
    expect(paths('scripts/*.sh')).toEqual([]);
  });

  it('lists each path once', () => {
    expect(paths('./a.sh && ./a.sh')).toEqual(['a.sh']);
  });

  it('reads a long command in linear time', () => {
    const line = `${'./a.sh && '.repeat(20_000)}x`;
    const started = performance.now();
    expect(paths(line)).toEqual(['a.sh']);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
