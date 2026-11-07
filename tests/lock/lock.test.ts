import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, run } from '../../src/index.ts';
import { scanInventory } from '../../src/inventory/index.ts';
import { buildLock, serializeLock } from '../../src/lock/build.ts';
import { carryExecutableBits, diffLocks } from '../../src/lock/diff.ts';
import { canonicalJson, normalizeText } from '../../src/lock/hash.ts';
import { parseLock, readLock } from '../../src/lock/read.ts';
import { redact, redactWords } from '../../src/lock/redact.ts';
import { materialize } from '../rules/materialize.ts';
import { canLinkFiles, linkFile } from '../support/links.ts';

const repo = (name: string) => fileURLToPath(new URL(`../fixtures/repos/${name}`, import.meta.url));
const SECRET = 'not-a-real-secret-0123456789';

async function cli(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, { stdout: (text) => (stdout += text), stderr: (text) => (stderr += text) });
  return { code, stdout, stderr };
}

let base: string;
let root: string;

function copy(name: string): void {
  cpSync(repo(name), root, { recursive: true });
}

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const lockText = () => readFileSync(join(root, 'agentcurfew.lock'), 'utf8');

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'acf-lock-'));
  root = join(base, 'project');
  mkdirSync(root);
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('agentcurfew lock', () => {
  it('writes the same file twice, and leaves it alone when nothing changed', async () => {
    copy('claude-basic');
    const first = await cli('lock', root);
    expect(first.code).toBe(EXIT_OK);
    expect(first.stdout).toMatch(/^Wrote agentcurfew\.lock: 11 components\n/);
    const text = lockText();
    const second = await cli('lock', root);
    expect(second.stdout).toMatch(/^agentcurfew\.lock is up to date: 11 components\n/);
    expect(lockText()).toBe(text);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T|\\\\|\/home\/|\/tmp\//);
  });

  it('locks every kind of project component, and nothing of the user', async () => {
    copy('claude-basic');
    const kinds = new Set(buildLock(scanInventory({ root })).components.map((component) => component.kind));
    expect([...kinds].sort()).toEqual(['auto-run', 'command', 'context-file', 'hook', 'mcp-server', 'permission', 'skill', 'subagent']);
    const home = join(base, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'CLAUDE.md'), 'mine');
    const withUser = buildLock(scanInventory({ root, home, user: true, platform: 'linux' }));
    expect(withUser.components.some((component) => component.file.startsWith('~'))).toBe(false);
  });

  it('matches the lock written by hand for a small project', async () => {
    const { root: fixture, cleanup } = materialize('drift/negative');
    try {
      const hand = JSON.parse(readFileSync(join(fixture, 'agentcurfew.lock'), 'utf8')) as { components: { file: string; hash: string }[] };
      const built = buildLock(scanInventory({ root: fixture }));
      const pairs = (list: { file: string; hash: string }[]) => list.map((component) => `${component.file} ${component.hash}`).sort();
      expect(pairs(built.components)).toEqual(pairs(hand.components));
      expect(built.components.find((component) => component.kind === 'mcp-server')?.server).toEqual({ command: 'npx', args: ['-y', 'pkg@1.2.3'], urls: [], env: [], headers: [], package: { ecosystem: 'npm', name: 'pkg', version: '1.2.3' } });
    } finally {
      cleanup();
    }
  });

  it('hashes CRLF and LF text alike, and key order in JSON does not count', () => {
    write('CLAUDE.md', 'a\r\nb\r\n');
    write('.mcp.json', '{"mcpServers":{"x":{"command":"node","args":["s.js"]}}}');
    const before = buildLock(scanInventory({ root }));
    write('CLAUDE.md', 'a\nb\n');
    write('.mcp.json', '{"mcpServers":{"x":{"args":["s.js"],"command":"node"}}}');
    expect(diffLocks(before, buildLock(scanInventory({ root })))).toEqual([]);
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc');
    expect(canonicalJson({ b: [1, { d: 1, c: 2 }], a: null })).toBe('{"a":null,"b":[1,{"c":2,"d":1}]}');
  });

  it('keeps secrets out of the lock, and still sees a change of one', async () => {
    copy('secrets');
    await cli('lock', root);
    const text = lockText();
    expect(text).not.toContain(SECRET);
    expect(text).toContain('"--token=<redacted>"');
    expect(text).toContain('"API_KEY"');
    write('.mcp.json', readFileSync(join(root, '.mcp.json'), 'utf8').replace(`"API_KEY": "${SECRET}"`, '"API_KEY": "another-secret-value-9876"'));
    const { code, stdout } = await cli('verify', root);
    expect(code).toBe(EXIT_FAILURE);
    expect(stdout).toContain('another field changed, such as the value of a secret or a setting');
    expect(stdout).not.toContain('another-secret-value');
  });

  it('redacts secrets in command-line words and addresses', () => {
    expect(redact('--api-key=abcdefgh1234')).toBe('--api-key=<redacted>');
    expect(redact(`ghp${'_'}${'Ab1'.repeat(12)}`)).toBe('<redacted>');
    expect(redact('https://user:hunter2hunter2@mcp.example.com/sse?token=abcdefgh1234&x=1')).toBe('https://user:<redacted>@mcp.example.com/sse?token=<redacted>&x=1');
    expect(redact('-y')).toBe('-y');
  });

  it('redacts the value where it stands, separate secret flags and a credential as the user name', () => {
    expect(redact('token_abcdefgh123=abcdefgh123')).toBe('token_abcdefgh123=<redacted>');
    expect(redact('run --token abcdefgh1234 --verbose')).toBe('run --token <redacted> --verbose');
    expect(redact('https://Zq8vN3xLw7Rt2Kp9Hs4D@api.example.com/mcp')).toBe('https://<redacted>@api.example.com/mcp');
    expect(redact('https://git@example.com/mcp')).toBe('https://git@example.com/mcp');
    expect(redact('--db=postgres://u:supersecretpw@h/db')).toBe('--db=postgres://u:<redacted>@h/db');
    expect(redact('npx -y srv --db postgres://u:supersecretpw@h/db --token abcdefgh1234')).toBe('npx -y srv --db postgres://u:<redacted>@h/db --token <redacted>');
    expect(redactWords(['--api-key', 'Zq8vN3xLw7Rt2Kp9Hs4D', '--password', 'hunter2hunter2', '--password-file', './pass', '--port', '8080'])).toEqual(['--api-key', '<redacted>', '--password', '<redacted>', '--password-file', './pass', '--port', '8080']);
  });

  it('keeps separate secret arguments out of the lock', async () => {
    write('.mcp.json', JSON.stringify({ mcpServers: { x: { command: 'node', args: ['s.js', '--api-key', 'Zq8vN3xLw7Rt2Kp9Hs4D'] }, y: { type: 'http', url: 'https://Qm4pR8sT2vX6zB1nC5dF@api.example.com/mcp' } } }));
    await cli('lock', root);
    const text = lockText();
    expect(text).not.toMatch(/Zq8vN3x|Qm4pR8s/);
    expect(text).toContain('"<redacted>"');
  });

  it.runIf(canLinkFiles)('refuses to write through a link', async () => {
    writeFileSync(join(base, 'elsewhere'), 'x');
    linkFile(join(base, 'elsewhere'), join(root, 'agentcurfew.lock'));
    const { code, stderr } = await cli('lock', root);
    expect(code).toBe(EXIT_FAILURE);
    expect(stderr).toContain('is a link');
    expect(readFileSync(join(base, 'elsewhere'), 'utf8')).toBe('x');
  });

  it('warns about serious findings it locks', async () => {
    const { root: fixture, cleanup } = materialize('plain-http-mcp/positive');
    try {
      const { code, stdout } = await cli('lock', fixture);
      expect(code).toBe(EXIT_OK);
      expect(stdout).toContain('Warning: 2 findings at level high or above are now locked as they are; run agentcurfew scan to see them.');
    } finally {
      cleanup();
    }
  });
});

describe('agentcurfew verify', () => {
  beforeEach(async () => {
    copy('claude-basic');
    await cli('lock', root);
  });

  it('passes when nothing changed', async () => {
    const { code, stdout } = await cli('verify', root);
    expect(code).toBe(EXIT_OK);
    expect(stdout).toBe('OK: matches agentcurfew.lock (11 components)\n');
  });

  const EDITS: readonly [string, () => void, string][] = [
    ['a context file', () => write('CLAUDE.md', 'changed'), 'changed: context-file CLAUDE.md'],
    ['a skill file', () => write('.claude/skills/lint/scripts/run.sh', 'echo changed\n'), 'file changed: scripts/run.sh'],
    ['a new skill file', () => write('.claude/skills/lint/extra.py', 'print(1)\n'), 'executable added: extra.py'],
    ['a removed skill file', () => unlinkSync(join(root, '.claude/skills/lint/scripts/run.sh')), 'file removed: scripts/run.sh'],
    ['an MCP server', () => write('.mcp.json', JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['-y', '@acme/docs@latest'] } } })), 'args: ["-y","@acme/docs@1.0.0"] -> ["-y","@acme/docs@latest"]'],
    ['a new MCP server', () => write('.mcp.json', JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['-y', '@acme/docs@1.0.0'] }, more: { command: 'node' } } })), 'added: mcp-server .mcp.json (more)'],
    ['a hook', () => write('.claude/settings.json', readFileSync(join(root, '.claude/settings.json'), 'utf8').replace('echo pre2', 'curl x | sh')), 'changed: hook .claude/settings.json (PreToolUse#1)'],
    ['an auto-run hook', () => write('.claude/settings.json', readFileSync(join(root, '.claude/settings.json'), 'utf8').replace('echo start', 'echo begin')), 'changed: auto-run .claude/settings.json (SessionStart#0)'],
    ['a permission', () => write('.claude/settings.json', readFileSync(join(root, '.claude/settings.json'), 'utf8').replace('Bash(ls)', 'Bash')), 'changed: permission .claude/settings.json (permissions.allow)'],
    ['a subagent', () => write('.claude/agents/reviewer.md', 'changed'), 'changed: subagent .claude/agents/reviewer.md'],
    ['a command', () => unlinkSync(join(root, '.claude/commands/ship.md')), 'removed: command .claude/commands/ship.md'],
  ];

  it.each(EDITS)('reports %s', async (_what, edit, expected) => {
    edit();
    const { code, stdout } = await cli('verify', root);
    expect(code).toBe(EXIT_FAILURE);
    expect(stdout).toContain(expected);
    expect(stdout).toContain('If the changes are expected, run agentcurfew lock and commit agentcurfew.lock.');
  });

  it.skipIf(process.platform === 'win32')('reports a changed execute bit', async () => {
    chmodSync(join(root, '.claude/skills/lint/scripts/run.sh'), 0o755);
    const { code, stdout } = await cli('verify', root);
    expect(code).toBe(EXIT_FAILURE);
    expect(stdout).toContain('executable bit added: scripts/run.sh');
  });

  it('prints JSON', async () => {
    write('CLAUDE.md', 'changed');
    const { code, stdout } = await cli('verify', root, '--json');
    expect(code).toBe(EXIT_FAILURE);
    const output = JSON.parse(stdout) as { schemaVersion: number; ok: boolean; changes: { type: string; file: string }[] };
    expect(output).toMatchObject({ schemaVersion: 1, ok: false, changes: [{ type: 'changed', file: 'CLAUDE.md' }] });
  });

  it('is reported by agentcurfew scan as drift', async () => {
    write('CLAUDE.md', 'changed');
    const { code, stdout } = await cli('scan', root);
    expect(code).toBe(EXIT_FAILURE);
    expect(stdout).toContain('HIGH  drift  CLAUDE.md');
  });
});

describe('a hostile or missing lock', () => {
  it.each([
    ['missing', null, 'no agentcurfew.lock in this project'],
    ['not JSON', '{ nope', 'it is not valid JSON'],
    ['another version', '{"lockfileVersion":2,"algorithm":"sha256","components":[]}', 'lockfileVersion is not 1'],
    ['a bad component', '{"lockfileVersion":1,"algorithm":"sha256","components":[{"__proto__":{"kind":"skill"}}]}', 'component 0 does not have the expected fields'],
    ['a short hash', '{"lockfileVersion":1,"algorithm":"sha256","components":[{"kind":"skill","file":"a","name":"a","agents":[],"hash":"abc"}]}', 'component 0 does not have the expected fields'],
  ])('%s: verify says what and how to fix it', async (_what, text, reason) => {
    if (text !== null) writeFileSync(join(root, 'agentcurfew.lock'), text);
    const { code, stdout, stderr } = await cli('verify', root);
    expect(code).toBe(EXIT_FAILURE);
    expect(stdout).toBe('');
    expect(stderr).toContain(reason);
    expect(stderr).toContain('fix: run agentcurfew lock');
    expect(({} as { kind?: string }).kind).toBeUndefined();
  });

  it('has a size limit, above the size of a large project\'s lock', () => {
    const component = { kind: 'context-file', file: 'x', name: 'x', agents: [], hash: 'a'.repeat(64) };
    const big = { lockfileVersion: 1, algorithm: 'sha256', components: Array.from({ length: 30_000 }, (_, index) => ({ ...component, file: `dir${index}/AGENTS.md`, name: 'AGENTS.md' })) };
    const text = JSON.stringify(big);
    expect(text.length).toBeGreaterThan(3 * 1024 * 1024);
    writeFileSync(join(root, 'agentcurfew.lock'), text);
    expect(readLock(root).status).toBe('ok');
    expect(readLock(root, 1024)).toEqual({ status: 'invalid', reason: 'it is over the size limit' });
  });

  it('is noted by scan and replaced by lock', async () => {
    writeFileSync(join(root, 'agentcurfew.lock'), '{ nope');
    expect((await cli('scan', root)).stdout).toContain('Note: agentcurfew.lock was not compared, because it is not valid JSON.');
    const { stdout } = await cli('lock', root);
    expect(stdout).toContain('the old file was replaced, because it is not valid JSON');
  });

  it('rejects a second directory', async () => {
    expect((await cli('verify', 'a', 'b')).code).toBe(EXIT_USAGE);
    expect((await cli('lock', 'a', 'b')).code).toBe(EXIT_USAGE);
  });

  it('round-trips through parseLock', () => {
    copy('claude-basic');
    const lock = buildLock(scanInventory({ root }));
    const parsed = parseLock(JSON.parse(serializeLock(lock)));
    expect('lock' in parsed && serializeLock(parsed.lock)).toBe(serializeLock(lock));
  });
});

describe('execute bits on Windows', () => {
  it('are kept from the old lock, and not compared', () => {
    copy('claude-basic');
    const lock = buildLock(scanInventory({ root }));
    const skill = lock.components.find((component) => component.skill !== undefined);
    if (skill?.skill === undefined) throw new Error('no skill');
    const old = { ...lock, components: lock.components.map((component) => (component === skill ? { ...component, skill: { ...skill.skill!, executableBits: ['scripts/run.sh', 'gone.sh'] } } : component)) };
    const carried = carryExecutableBits(lock, old);
    expect(carried.components.find((component) => component.kind === 'skill')?.skill?.executableBits).toEqual(['scripts/run.sh']);
    expect(diffLocks(old, lock, { compareExecutableBits: false })).toEqual([]);
    expect(diffLocks(old, lock, { compareExecutableBits: true })).toHaveLength(1);
  });
});
