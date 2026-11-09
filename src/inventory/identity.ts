import { canonicalJson, sha256 } from '../lock/hash.ts';
import { redactedValue } from '../lock/redact.ts';

/**
 * Stable ids of components (D-042). A hook's name is its position (PreToolUse#0), which shifts when a hook is added
 * before it; its id is its event, its matcher and a short hash of the handler, so it stays as long as the hook does. The
 * hash is taken over the entry with its secrets redacted, like the lock's hashes (D-035), so an id confirms no secret.
 */

/** A part of an id as written, or a short hash of it when it is long or holds characters an id should not carry. */
function part(text: string, prefix: string): string {
  return text.length <= 64 && !/[\p{C}\s]/u.test(text) ? text : `${prefix}-${sha256(text).slice(0, 8)}`;
}

function digest(value: unknown): string {
  return sha256(canonicalJson(redactedValue(value))).slice(0, 10);
}

/** The id of a hook: its event, its matcher (* when it has none) and a hash of the handler with its group fields. */
export function hookId(event: string, entry: unknown): string {
  const matcher = typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? (entry as Record<string, unknown>).matcher : undefined;
  const matcherPart = typeof matcher === 'string' && matcher !== '' ? part(matcher, 'm') : '*';
  return `${part(event, 'e')}:${matcherPart}:${digest(entry)}`;
}

/** The id of an editor task: its label, which names it in the editor, or a hash of it when it has none. */
export function taskId(task: unknown, name: string): string {
  const label = typeof task === 'object' && task !== null && !Array.isArray(task) ? (task as Record<string, unknown>).label : undefined;
  return typeof label === 'string' ? name : `task:${digest(task)}`;
}

/** The same ids, with ~2, ~3 and so on added to the second and later copies of one id, in order. */
export function numbered(ids: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    return count === 1 ? id : `${id}~${count}`;
  });
}
