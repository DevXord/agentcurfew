import { parse } from 'yaml';
import { deeperThan, MAX_DEPTH } from './parse.ts';

/**
 * Frontmatter is small in practice, and the cost of parsing YAML grows faster than its size (D-012): at this limit the
 * worst input found took under 0.2 s.
 */
export const MAX_FRONTMATTER_BYTES = 32 * 1024;

const OPTIONS = {
  schema: 'core',
  merge: false,
  maxAliasCount: 50,
  uniqueKeys: true,
  strict: true,
  prettyErrors: false,
  // 'silent' would also stop parse from throwing on errors such as duplicate keys.
  logLevel: 'error',
} as const;

export type Frontmatter =
  | { status: 'none' }
  | { status: 'too-large' }
  | { status: 'unparsable' }
  | { status: 'ok'; value: unknown; /** 1-based line of the file where the YAML starts. */ line: number };

/** The YAML between a first line of --- and the next line of --- or ..., not parsed. */
export function frontmatterText(text: string): { yaml: string; line: number } | undefined {
  const source = text.replace(/^\uFEFF/, '');
  const open = /^---[ \t]*\r?\n/.exec(source);
  if (open === null) return undefined;
  const rest = source.slice(open[0].length);
  const close = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (close === null) return undefined;
  return { yaml: rest.slice(0, close.index), line: 2 };
}

/** The frontmatter of a Markdown file, parsed with limits. Tags and merge keys are read as plain data. */
export function parseFrontmatter(text: string): Frontmatter {
  const block = frontmatterText(text);
  if (block === undefined) return { status: 'none' };
  if (Buffer.byteLength(block.yaml) > MAX_FRONTMATTER_BYTES) return { status: 'too-large' };
  try {
    const value: unknown = parse(block.yaml, OPTIONS);
    if (deeperThan(value, MAX_DEPTH)) return { status: 'unparsable' };
    return { status: 'ok', value: value ?? {}, line: block.line };
  } catch {
    return { status: 'unparsable' };
  }
}
