import { computedHash, falseMismatchReason } from '../../lock/skills-lock.ts';
import type { ProjectHit, Rule } from '../types.ts';

export const skillsLockMismatch: Rule = {
  id: 'skills-lock-mismatch',
  title: 'Skill differs from skills-lock.json',
  level: 'medium',
  owasp: ['AST07'],
  description:
    'Recomputes computedHash, the checksum that the skills installer writes to skills-lock.json, over each installed skill the file lists, and reports the skills whose folder no longer matches it, and entries with no installed skill. The installer usually takes the hash at the source, not from the copy it installs, so a skill that was never touched can still differ; when the folder shows a known cause, the finding is low and names it.',
  levels: 'info when skills-lock.json or a skill file could not be read, or a listed skill is not installed; low when the difference has a known cause',
  fix: 'Reinstall the skill with the skills installer, or update skills-lock.json, after checking what changed in the folder. Lock the result with agentcurfew lock.',
  falsePositives:
    'The installer hashes the source, drops metadata.json, __pycache__ and __pypackages__ and copies links as files, and sorts paths by the machine\'s locale, so a mismatch is not proof of tampering.',
  example: 'skills-lock.json says computedHash 3f2a... for "lint", but .agents/skills/lint hashes to 9b1c...',
  kinds: [],
  check: () => [],
  checkProject(inventory, context) {
    const read = context.skillsLock;
    if (read === undefined || read.status === 'missing') return [];
    if (read.status === 'invalid') return [{ kind: 'skill', file: 'skills-lock.json', name: 'skills-lock.json', message: 'skills-lock.json could not be read as version 1 of its format, so it was not compared', level: 'info' }];
    const hits: ProjectHit[] = [];
    for (const entry of read.entries) {
      const installed = inventory.components.filter((component) => component.kind === 'skill' && component.scope === 'project' && component.name === entry.name);
      if (installed.length === 0) {
        hits.push({ kind: 'skill', file: read.file, name: entry.name, message: 'listed in skills-lock.json, but not installed in a skills folder of the project', level: 'info' });
        continue;
      }
      const hashes = installed.map((component) => ({ component, hash: computedHash(component) }));
      if (hashes.some(({ hash }) => hash === entry.computedHash)) continue;
      for (const { component, hash } of hashes) {
        if (hash === undefined) {
          hits.push({ kind: 'skill', file: component.file, name: component.name, message: 'a file of the skill could not be read, so its computedHash was not compared', level: 'info' });
          continue;
        }
        const reason = falseMismatchReason(component);
        hits.push({
          kind: 'skill',
          file: component.file,
          name: component.name,
          message: `the folder does not match computedHash in skills-lock.json${reason === undefined ? '' : `, possibly because ${reason}`}`,
          ...(reason === undefined ? {} : { level: 'low' as const }),
        });
      }
    }
    return hits;
  },
};
