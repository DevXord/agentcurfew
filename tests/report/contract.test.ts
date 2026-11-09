import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/index.ts';
import { knowledgeDate } from '../../src/knowledge/index.ts';
import { getVersion } from '../../src/version.ts';
import { materialize } from '../rules/materialize.ts';

const repo = (name: string) => fileURLToPath(new URL(`../fixtures/repos/${name}`, import.meta.url));

async function json(...argv: string[]): Promise<Record<string, unknown>> {
  let stdout = '';
  await run(argv, { stdout: (text) => (stdout += text), stderr: () => undefined });
  return JSON.parse(stdout) as Record<string, unknown>;
}

describe('the data contract of the JSON output', () => {
  it('names its producer in every command, with no time in it', async () => {
    const producer = { name: 'agentcurfew', version: getVersion(), knowledge: knowledgeDate() };
    const { root, cleanup } = materialize('drift/positive');
    try {
      for (const argv of [['scan', root, '--json'], ['scan', root, '--inventory', '--json'], ['verify', root, '--json'], ['doctor', root, '--json']]) {
        expect((await json(...argv)).producer, argv.join(' ')).toEqual(producer);
      }
    } finally {
      cleanup();
    }
  });

  it('dates the knowledge base by its newest fact', () => {
    expect(knowledgeDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(knowledgeDate() >= '2026-11-08').toBe(true);
  });

  it('gives each component its id and the checksum the lock would hold', async () => {
    const inventory = (await json('scan', repo('claude-basic'), '--inventory', '--json')) as { components: { kind: string; name: string; id: string; hash?: string; scope: string }[] };
    for (const component of inventory.components) {
      expect(component.id).toBeTruthy();
      if (component.scope === 'project') expect(component.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('ties each finding to its component by id', async () => {
    const { root, cleanup } = materialize('dangerous-hook-command/positive');
    try {
      const scan = (await json('scan', root, '--json')) as { findings: { kind: string; name: string; componentId?: string }[] };
      const hook = scan.findings.find((finding) => finding.kind === 'hook');
      expect(hook?.componentId).toMatch(/:[0-9a-f]{10}$/);
    } finally {
      cleanup();
    }
  });

  it('keeps the SARIF fingerprint of 1.0 and adds one by component id', async () => {
    const { root, cleanup } = materialize('dangerous-hook-command/positive');
    try {
      let stdout = '';
      await run(['scan', root, '--sarif'], { stdout: (text) => (stdout += text), stderr: () => undefined });
      const sarif = JSON.parse(stdout) as { runs: { results: { partialFingerprints: Record<string, string>; properties: Record<string, unknown> }[] }[] };
      for (const result of sarif.runs[0]!.results) {
        expect(result.partialFingerprints['agentcurfew/v1']).toMatch(/^[0-9a-f]{32}$/);
        expect(result.partialFingerprints['agentcurfew/v2']).toMatch(/^[0-9a-f]{32}$/);
        expect(result.properties.componentId).toBeTruthy();
      }
    } finally {
      cleanup();
    }
  });
});
