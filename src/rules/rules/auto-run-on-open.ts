import { parseFrontmatter } from '../../inventory/frontmatter.ts';
import type { Rule, RuleHit } from '../types.ts';
import { isRecord } from '../text.ts';

export const autoRunOnOpen: Rule = {
  id: 'auto-run-on-open',
  title: 'Starts without a user action',
  level: 'high',
  owasp: ['AST06'],
  description:
    'Reports every component that starts on its own: editor tasks that run when the folder is opened (runOptions.runOn folderOpen in .vscode/tasks.json), hooks on events that fire when a workspace opens or a session starts, and scheduled agent runs (Cline cron specs, which run in yolo mode unless they say otherwise). A repository that is cloned and opened can then run commands before anyone has read them.',
  levels: 'medium for a hook that runs when a session starts, high for a task that runs when the folder opens, and for a scheduled task in yolo mode',
  fix: 'Remove the automatic trigger, or make the task run on demand. If it must stay, keep the command short and reviewable, and make sure the editor or agent asks for trust before running it.',
  falsePositives: 'Where the knowledge base marks the fact as uncertain, the agent may in practice ask before running it; the message says so.',
  example: '"runOptions": { "runOn": "folderOpen" } in .vscode/tasks.json',
  kinds: ['auto-run'],
  check(component, context) {
    // A hook that starts on its own rests on the hooks fact (Cursor's workspaceOpen) or the autoRun fact (SessionStart).
    const hook = component.name.includes('#');
    const uncertain = component.agents.every((id) => {
      const agent = context.knowledge.find((candidate) => candidate.id === id);
      if (agent === undefined) return false;
      return agent.autoRun.status === 'uncertain' && (!hook || agent.hooks.status === 'uncertain' || /^sessionstart#/i.test(component.name));
    });
    const doubt = uncertain ? '; the knowledge base marks this behaviour as uncertain' : '';
    if (/^SessionStart#/.test(component.name) || /^sessionStart#/.test(component.name)) {
      return [{ message: `runs when an agent session starts, before the first prompt${doubt}`, level: 'medium' }];
    }
    if (hook) return [{ message: `a hook on ${component.name.slice(0, component.name.indexOf('#'))}, which fires with no user action${doubt}` }];
    if (/\.md$/i.test(component.file)) {
      const frontmatter = parseFrontmatter(component.raw);
      const spec = frontmatter.status === 'ok' && isRecord(frontmatter.value) ? frontmatter.value : {};
      if (spec.enabled === false) return [];
      const mode = typeof spec.mode === 'string' ? spec.mode : 'yolo';
      const hit: RuleHit = {
        message: `a scheduled agent run in ${mode.replace(/\p{C}/gu, '?')} mode${mode === 'yolo' ? ', which approves every tool' : ''}${doubt}`,
        level: mode === 'yolo' ? 'high' : 'medium',
      };
      return [hit];
    }
    return [{ message: `runs when the folder is opened${doubt}` }];
  },
};
