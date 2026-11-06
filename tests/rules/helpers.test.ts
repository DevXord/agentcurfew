import { describe, expect, it } from 'vitest';
import type { Component } from '../../src/inventory/index.ts';
import { agentFileNames } from '../../src/rules/agent-files.ts';
import { applyRules, runRules } from '../../src/rules/index.ts';
import type { Rule } from '../../src/rules/index.ts';
import { maskSecret, quote } from '../../src/rules/mask.ts';
import { toolList } from '../../src/rules/rules/broad-shell-permission.ts';
import { knownSecrets, namedSecret, pairs } from '../../src/rules/secrets.ts';
import { position } from '../../src/rules/text.ts';
import { knowledgeBase } from '../../src/knowledge/index.ts';

const component = (raw: string, extra: Partial<Component> = {}): Component => ({ kind: 'context-file', agents: ['claude-code'], scope: 'project', file: 'CLAUDE.md', name: 'CLAUDE.md', raw, ...extra });

describe('rule helpers', () => {
  it('mask secrets and quote hostile text', () => {
    expect(maskSecret('abcdefghijkl')).toBe('abcd… (12 characters)');
    expect(quote('a\u001b[31mb\u202E', 60)).toBe('a?[31mb?');
    expect(quote('x'.repeat(10), 4)).toBe('xxxx…');
  });

  it('count columns in code points', () => {
    expect(position('ab\n😀x', 5)).toEqual({ line: 2, column: 2 });
  });

  it('split tool lists the way Claude Code reads allowed-tools', () => {
    expect(toolList('Bash(git add *) Bash(git commit *), Read')).toEqual(['Bash(git add *)', 'Bash(git commit *)', 'Read']);
    expect(toolList(['Read', 'Bash(*)', 3])).toEqual(['Read', 'Bash(*)']);
  });

  it('tell literal secrets from references to them', () => {
    expect(namedSecret('API_KEY', 'abcdefghijk')).toBe('abcd… (11 characters)');
    for (const reference of ['${API_KEY}', '$API_KEY', '%API_KEY%', '${env:API_KEY}', '${input:key}', '<your key>', 'your-api-key', 'xxxxxxxx', 'Bearer ${TOKEN}', '4096']) {
      expect(namedSecret('API_KEY', reference), reference).toBeUndefined();
    }
    expect(namedSecret('PORT', 'abcdefghijk')).toBeUndefined();
    expect(pairs('run --token=abc12345 -H "Authorization: Bearer xyz98765"').map((pair) => `${pair.key}=${pair.value}`)).toEqual(['--token=abc12345', 'Authorization=Bearer xyz98765']);
    expect(knownSecrets(`key AKI${'A'}${'Z9'.repeat(8)} end`).map((match) => match.what)).toEqual(['AWS access key']);
    expect(knownSecrets(`sk-${'ant'}-${'a1'.repeat(15)}`).map((match) => match.what)).toEqual(['Anthropic API key']);
  });

  it('take agent file names from the knowledge base', () => {
    const names = agentFileNames(knowledgeBase);
    for (const name of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.mcp.json', '.claude/settings.json', 'SKILL.md', 'tasks.json']) expect(names).toContain(name);
    expect(names).not.toContain('settings.json');
  });
});

describe('rule engine', () => {
  const inventory = { components: [component('a\u200Bb\u200Bc')], problems: [] };

  it('reports a rule that throws, and goes on', () => {
    const broken: Rule = { id: 'broken', title: 'Broken rule', level: 'high', owasp: ['AST08'], description: 'Always throws.', fix: 'None.', example: 'none at all', kinds: ['context-file'], check: () => { throw new Error('boom'); } };
    const findings = applyRules(inventory, [broken], { knowledge: knowledgeBase });
    expect(findings).toEqual([{ rule: 'broken', level: 'info', kind: 'context-file', file: 'CLAUDE.md', name: 'CLAUDE.md', message: 'the rule failed on this component, so it was not checked' }]);
  });

  it('caps the findings of one rule on one component', () => {
    const many = { components: [component(Array.from({ length: 30 }, () => 'x\u200B').join(' '))], problems: [] };
    const findings = runRules(many).filter((finding) => finding.rule === 'hidden-unicode');
    expect(findings).toHaveLength(21);
    expect(findings.some((finding) => finding.message === '10 more findings of this rule were left out')).toBe(true);
  });

  it('is deterministic', () => {
    expect(runRules(inventory)).toEqual(runRules(inventory));
  });

  it('does not flag ordinary text', () => {
    const text = '# Project\n\nUse `npm test`. Keep AGENTS.md short. See https://example.com/docs.\n';
    expect(runRules({ components: [component(text)], problems: [] })).toEqual([]);
  });
});
