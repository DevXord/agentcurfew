import { buildLock } from '../../lock/build.ts';
import { diffLocks } from '../../lock/diff.ts';
import type { ProjectHit, Rule } from '../types.ts';

const MAX_DETAILS = 5;

export const drift: Rule = {
  id: 'drift',
  title: 'Component changed since it was locked',
  level: 'high',
  owasp: ['AST07'],
  description:
    'Compares the project with agentcurfew.lock, when there is one, and reports every component that was added, removed or changed since the last agentcurfew lock: a skill file, an MCP server\'s command, arguments or address, a hook, a context file, a permission. A skill or configuration can change after it was reviewed, through an update, a merge or a compromised dependency, and nobody notices unless the change is compared with what was approved.',
  fix: 'Review the change. If it is expected, run agentcurfew lock and commit the new agentcurfew.lock with it; if not, restore the component from version control.',
  example: '.mcp.json (fs): args: ["-y","server@1.2.3"] -> ["-y","server@latest"]',
  kinds: [],
  check: () => [],
  checkProject(inventory, context) {
    if (context.lock === undefined) return [];
    const options = context.compareExecutableBits === undefined ? {} : { compareExecutableBits: context.compareExecutableBits };
    const changes = diffLocks(context.lock, buildLock(inventory, context.knowledge), options);
    return changes.map((change): ProjectHit => {
      const shown = change.details.slice(0, MAX_DETAILS);
      const more = change.details.length > MAX_DETAILS ? `; and ${change.details.length - MAX_DETAILS} more` : '';
      const message =
        change.type === 'added' ? 'not in agentcurfew.lock: added since it was locked' : change.type === 'removed' ? 'in agentcurfew.lock, but no longer in the project' : `changed since it was locked: ${shown.join('; ')}${more}`;
      return { kind: change.kind, file: change.file, name: change.name, message };
    });
  },
};
