import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeProjectAsync } from '../../src/analyze.ts';
import { checkMcpPackages, depcurfewSpec, setDepcurfewLoader } from '../../src/depcurfew/bridge.ts';
import { scanInventory } from '../../src/inventory/index.ts';
import { materialize } from '../rules/materialize.ts';

const realLoader = async () => (await import('depcurfew')) as typeof import('depcurfew');

afterEach(() => setDepcurfewLoader(realLoader));

async function onFixture(path: string, prepare?: (root: string) => void) {
  const { root, cleanup } = materialize(path);
  try {
    prepare?.(root);
    return await checkMcpPackages(scanInventory({ root }), root);
  } finally {
    cleanup();
  }
}

describe('the depcurfew bridge', () => {
  it('checks the packages of MCP servers offline with the installed depcurfew', async () => {
    const { state, reports } = await onFixture('mcp-package/positive');
    expect(state).toEqual({ status: 'ready', version: '1.5.2' });
    expect([...reports.entries()].map(([key, report]) => [key.replace('\0', ' '), report.spec, report.findings.map((finding) => `${finding.level}:${finding.code}`)])).toEqual([
      ['.mcp.json from-git', 'github:someone/mcp-server', ['error:forbidden-source']],
      ['.mcp.json tarball', 'https://example.com/mcp-server-1.0.0.tgz', ['error:forbidden-source']],
    ]);
  });

  it('reports nothing that only the registry could tell', async () => {
    const { reports } = await onFixture('mcp-package/negative');
    expect([...reports.values()].map((report) => [report.spec, report.findings])).toEqual([
      ['@modelcontextprotocol/server-filesystem@2026.1.14', []],
      ['pypi:mcp-server-git==2.1.0', []],
    ]);
  });

  it('checks nothing without depcurfew, with another major version or without depcurfew.json, and says why', async () => {
    setDepcurfewLoader(async () => undefined);
    expect((await onFixture('mcp-package/positive')).state).toEqual({ status: 'missing', reason: 'depcurfew is not installed' });
    setDepcurfewLoader(async () => ({ ...(await realLoader()), getVersion: () => '2.0.0' }) as typeof import('depcurfew'));
    expect((await onFixture('mcp-package/positive')).state.status).toBe('unsupported');
    setDepcurfewLoader(realLoader);
    expect((await onFixture('unpinned-mcp-server/positive')).state).toEqual({ status: 'no-policy', reason: 'the project has no depcurfew.json' });
    const broken = await onFixture('mcp-package/positive', (root) => writeFileSync(join(root, 'depcurfew.json'), '{"version": 9}'));
    expect(broken.state.status).toBe('invalid-policy');
    expect(broken.reports.size).toBe(0);
  });

  it('keeps the rule silent without depcurfew, and unpinned-mcp-server still points to depcurfew', async () => {
    setDepcurfewLoader(async () => undefined);
    const { root, cleanup } = materialize('mcp-package/positive');
    try {
      const { findings } = await analyzeProjectAsync(root);
      expect(findings.filter((finding) => finding.rule === 'mcp-package')).toEqual([]);
      expect(findings.some((finding) => finding.rule === 'unpinned-mcp-server')).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('writes the specs depcurfew reads', () => {
    expect(depcurfewSpec('npm', '@scope/x@1.0.0')).toBe('@scope/x@1.0.0');
    expect(depcurfewSpec('uv', 'mcp-server-git@2.1.0')).toBe('pypi:mcp-server-git==2.1.0');
    expect(depcurfewSpec('uv', 'mcp-server-git==2.1.0')).toBe('pypi:mcp-server-git==2.1.0');
    expect(depcurfewSpec('docker', 'ghcr.io/x/y')).toBeUndefined();
  });
});

describe('no package checks of our own', () => {
  // depcurfew owns release ages, similar names and known malicious versions (CLAUDE.md); only the bridge may name its API.
  const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]));

  it('keeps depcurfew calls in src/depcurfew and has no such logic elsewhere', () => {
    for (const file of files(SRC)) {
      const text = readFileSync(file, 'utf8');
      const inBridge = file.includes(`${join('src', 'depcurfew')}`);
      if (!inBridge) expect(text, file).not.toMatch(/from 'depcurfew'|import\('depcurfew'\)|PopularNames|LocalOsvData|queryOsv|osv\.dev|publishedAt|min-release-age|typosquat/i);
    }
  });
});

describe('the built package', () => {
  it('imports depcurfew at run time and bundles none of its code', () => {
    const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
    const code = readdirSync(dist).filter((name) => name.endsWith('.js')).map((name) => readFileSync(join(dist, name), 'utf8')).join('\n');
    expect(code).toContain('import("depcurfew")');
    expect(code).not.toMatch(/class (?:LocalOsvData|PopularNames)\b|function (?:planRepository|checkSpecs|queryOsv)\b/);
  });
});
