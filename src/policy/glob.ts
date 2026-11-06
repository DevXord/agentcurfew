const cache = new Map<string, RegExp>();

/**
 * Whether a /-separated path matches a glob: * stays within a segment, ** crosses segments, ? is one character. A glob
 * that names a folder also matches everything below it.
 */
export function globMatch(glob: string, path: string): boolean {
  let regex = cache.get(glob);
  if (regex === undefined) {
    let source = '';
    for (let index = 0; index < glob.length; index++) {
      const char = glob[index] as string;
      if (char === '*' && glob[index + 1] === '*') {
        source += '.*';
        index++;
        if (glob[index + 1] === '/') index++;
      } else if (char === '*') {
        source += '[^/]*';
      } else if (char === '?') {
        source += '[^/]';
      } else {
        source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      }
    }
    regex = new RegExp(`^${source}(?:/.*)?$`, 's');
    cache.set(glob, regex);
  }
  return regex.test(path);
}
