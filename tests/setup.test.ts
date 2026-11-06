import { execSync, spawn } from 'node:child_process';
import { request } from 'node:http';
import { describe, expect, it } from 'vitest';

describe('test guards', () => {
  it('blocks starting a process, also through named imports', () => {
    expect(() => spawn('node')).toThrow(/disabled in tests/);
    expect(() => execSync('node')).toThrow(/disabled in tests/);
  });

  it('blocks the network, also through named imports', async () => {
    expect(() => request('http://example.test')).toThrow(/disabled in tests/);
    await expect(fetch('http://example.test')).rejects.toThrow(/disabled in tests/);
  });
});
