import fc from 'fast-check';
import { describe, it } from 'vitest';
import { EXIT_OK, EXIT_USAGE, run } from '../../src/index.ts';

describe('command line', () => {
  it('ends with a usage result on any arguments, without control characters in the output', async () => {
    const word = fc.oneof(fc.string({ unit: 'binary' }), fc.constantFrom('--help', '-h', '--version', '-v', '--', '-', 'help'));
    await fc.assert(
      fc.asyncProperty(fc.array(word, { maxLength: 6 }), async (argv) => {
        let output = '';
        const write = (text: string) => {
          output += text;
        };
        const code = await run(argv, { stdout: write, stderr: write });
        // eslint-disable-next-line no-control-regex
        return (code === EXIT_OK || code === EXIT_USAGE) && !/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(output);
      }),
      { numRuns: 2000 },
    );
  });
});
