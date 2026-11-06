export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  /** Whether labels on stdout may be colored; false or absent prints plain text. */
  color?: boolean;
}
