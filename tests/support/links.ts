import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Whether this system lets a test create file links: Windows refuses them without Developer Mode. */
export const canLinkFiles: boolean = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'acf-link-'));
  try {
    writeFileSync(join(dir, 'target'), '');
    symlinkSync(join(dir, 'target'), join(dir, 'link'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

/** A file link; call only where canLinkFiles. */
export function linkFile(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, 'file');
}

/** A directory link: a junction on Windows, which needs no privilege. */
export function linkDirectory(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, 'junction');
}
