import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/fuzz/**/*.fuzz.ts'],
    setupFiles: ['tests/setup/no-network.ts', 'tests/setup/no-subprocess.ts'],
  },
});
