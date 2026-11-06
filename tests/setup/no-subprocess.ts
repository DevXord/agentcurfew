// The scanner never runs what it finds, so no code under test may start a process at all.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const APIS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const;

for (const api of APIS) {
  Object.defineProperty(childProcess, api, {
    configurable: true,
    writable: true,
    value: () => {
      throw new Error(`Starting a process is disabled in tests (child_process.${api})`);
    },
  });
}

syncBuiltinESMExports();
