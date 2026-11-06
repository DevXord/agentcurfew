import { knowledgeBase } from '../knowledge/index.ts';
import type { RuleContext } from '../rules/types.ts';
import { readLock } from './read.ts';
import type { LockRead } from './read.ts';
import { readSkillsLock } from './skills-lock.ts';

/** What the rules need beyond the inventory: the project's locks, read as untrusted files. */
export function projectContext(root: string): { context: RuleContext; lock: LockRead } {
  const lock = readLock(root);
  const context: RuleContext = { knowledge: knowledgeBase, skillsLock: readSkillsLock(root), compareExecutableBits: process.platform !== 'win32' };
  if (lock.status === 'ok') context.lock = lock.lock;
  return { context, lock };
}
