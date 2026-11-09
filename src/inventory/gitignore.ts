/**
 * A subset of .gitignore, enough to tell build output and installed packages from files committed to the repository:
 * blank lines and # comments, ! negations (the last matching line wins), a trailing / for folders, a leading or inner /
 * to anchor a pattern at the root, and *, ** and ? wildcards. Only the root .gitignore is read; nested ones, the global
 * excludes file and .git/info/exclude are not, so a file ignored only there is treated as committed.
 */

interface Pattern {
  /** The pattern's segments; ** matches any number of folders. */
  segments: readonly string[];
  /** Contains a / other than a trailing one: matched against the whole path, else against the last segment. */
  anchored: boolean;
  negated: boolean;
  /** Matches folders only. */
  folder: boolean;
}

/** Lines past this many are not read: a root .gitignore is short, and every line is matched against every script. */
const MAX_PATTERNS = 1000;

/** One segment against a glob of *, ? and literal characters, in time linear in their product (no backtracking). */
function segmentMatches(glob: string, text: string): boolean {
  let previous = new Array<boolean>(text.length + 1).fill(false);
  previous[0] = true;
  for (const char of glob) {
    const next = new Array<boolean>(text.length + 1).fill(false);
    if (char === '*') {
      next[0] = previous[0] as boolean;
      for (let index = 1; index <= text.length; index++) next[index] = (previous[index] as boolean) || (next[index - 1] as boolean);
    } else {
      for (let index = 1; index <= text.length; index++) next[index] = (previous[index - 1] as boolean) && (char === '?' || text[index - 1] === char);
    }
    previous = next;
  }
  return previous[text.length] as boolean;
}

/** Path segments against pattern segments, ** standing for any number of folders; dynamic programming, no backtracking. */
function pathMatches(pattern: readonly string[], path: readonly string[]): boolean {
  let previous = new Array<boolean>(path.length + 1).fill(false);
  previous[0] = true;
  for (const segment of pattern) {
    const next = new Array<boolean>(path.length + 1).fill(false);
    if (segment === '**') {
      next[0] = previous[0] as boolean;
      for (let index = 1; index <= path.length; index++) next[index] = (previous[index] as boolean) || (next[index - 1] as boolean);
    } else {
      for (let index = 1; index <= path.length; index++) next[index] = (previous[index - 1] as boolean) && segmentMatches(segment, path[index - 1] as string);
    }
    previous = next;
  }
  return previous[path.length] as boolean;
}

export function parseGitignore(text: string): readonly Pattern[] {
  const patterns: Pattern[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (patterns.length >= MAX_PATTERNS) break;
    // Trailing spaces are dropped; git keeps an escaped one, which this subset does not.
    let line = raw.trimEnd();
    if (line === '' || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    if (negated) line = line.slice(1);
    line = line.replace(/^\\([#!])/, '$1');
    const folder = line.endsWith('/');
    if (folder) line = line.slice(0, -1);
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    if (line === '') continue;
    patterns.push({ segments: line.split('/'), anchored, negated, folder });
  }
  return patterns;
}

/** Folders above a path that are matched against the patterns; deeper paths are not files a scan reads. */
const MAX_DEPTH = 64;

/** Whether a path relative to the root, with / separators, is ignored: the file itself or a folder above it. */
export function isIgnored(patterns: readonly Pattern[], path: string): boolean {
  const segments = path.split('/');
  // A path this deep is not read at all (script paths are capped likewise), so it is not matched: a padded path must not
  // cost the product of its depth and the number of patterns again for each folder (review of 2026-11-09).
  if (segments.length > MAX_DEPTH) return false;
  // A file below an ignored folder stays ignored: git does not look inside it, so a negation cannot bring it back.
  for (let end = 1; end < segments.length; end++) {
    if (matches(patterns, segments.slice(0, end), true)) return true;
  }
  return matches(patterns, segments, false);
}

function matches(patterns: readonly Pattern[], segments: readonly string[], isFolder: boolean): boolean {
  let ignored = false;
  for (const pattern of patterns) {
    if (pattern.folder && !isFolder) continue;
    const hit = pattern.anchored ? pathMatches(pattern.segments, segments) : segmentMatches(pattern.segments.join('/'), segments.at(-1) ?? '');
    if (hit) ignored = !pattern.negated;
  }
  return ignored;
}
