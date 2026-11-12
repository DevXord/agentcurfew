import { describe, expect, it } from 'vitest';
import { knowledgeBase } from '../../src/knowledge/index.ts';
import type { AgentKnowledge, Evidence, Fact } from '../../src/knowledge/types.ts';

// Knowledge review W1 (2026-11-12): facts read again that day, and the corrections it made.
const W1 = '2026-11-12';

function agent(id: AgentKnowledge['id']): AgentKnowledge {
  const found = knowledgeBase.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no knowledge about ${id}`);
  return found;
}

function evidence(fact: Fact<unknown>): readonly Evidence<unknown>[] {
  return fact.status === 'disputed' ? fact.variants : [fact];
}

function field(id: AgentKnowledge['id'], name: string): Fact<unknown> {
  const fact = (agent(id) as unknown as Record<string, Fact<unknown> | undefined>)[name];
  if (fact === undefined) throw new Error(`${id} has no ${name}`);
  return fact;
}

function note(fact: Fact<unknown>): string {
  return [fact.note ?? '', ...evidence(fact).map((item) => item.note ?? '')].join(' ');
}

function readOnW1(fact: Fact<unknown>): boolean {
  return evidence(fact).every((item) => item.verifiedAt === W1);
}

describe('knowledge review W1', () => {
  it('says that disableAllHooks stops installed mods but not built-in ones', () => {
    const fact = field('claude-code', 'hooksOff');
    expect(note(fact)).toContain('mods');
    expect(note(fact)).toContain('built-in');
    expect(readOnW1(fact)).toBe(true);
  });

  it('records the nested-skill changes of Claude Code 2.1.319 and 2.1.321', () => {
    const fact = field('claude-code', 'skills');
    expect(note(fact)).toContain('/cd');
    expect(note(fact)).toContain('~/.claude/plugins');
    expect(readOnW1(fact)).toBe(true);
  });

  it('says that --add-dir marketplaces need the trust of that folder', () => {
    const fact = field('claude-code', 'plugins');
    expect(note(fact)).toContain('--add-dir');
    expect(readOnW1(fact)).toBe(true);
  });

  it('says how a Codex project becomes trusted on the stable and the alpha line', () => {
    const fact = field('codex', 'precedence');
    expect(note(fact)).toContain('trust_level');
    expect(note(fact)).toContain('0.167.2');
    expect(note(fact)).toContain('--trust');
    expect(readOnW1(fact)).toBe(true);
    expect(readOnW1(field('codex', 'skills'))).toBe(true);
  });

  it('notes GEMINI.md and recursive .claude/rules of the Copilot runtime without scanning them yet', () => {
    const fact = field('copilot-vscode', 'contextFiles');
    expect(note(fact)).toContain('GEMINI.md');
    expect(note(fact)).toContain('.claude/rules/**/*.md');
    expect(note(fact)).toContain('1.6.0-a');
    expect(JSON.stringify(fact)).not.toContain('"path":"GEMINI.md"');
    expect(readOnW1(fact)).toBe(true);
  });

  it('drops the Copilot quote that is gone from the MCP reference', () => {
    const fact = field('copilot-vscode', 'permissions');
    expect(note(fact)).not.toContain('controlled environment');
    expect(note(fact)).toContain('Workspace settings are not copied');
    expect(readOnW1(field('copilot-vscode', 'skills'))).toBe(true);
    expect(readOnW1(fact)).toBe(true);
  });

  it('records which Devin MCP file wins and that Devin Desktop accepts serverUrl', () => {
    const fact = field('windsurf', 'mcp');
    expect(note(fact)).toContain('merged by name');
    expect(note(fact)).toContain('serverUrl');
    expect(note(fact)).not.toContain('search summary');
    expect(readOnW1(fact)).toBe(true);
    expect(readOnW1(field('windsurf', 'autoRun'))).toBe(true);
    expect(readOnW1(field('windsurf', 'extensions'))).toBe(true);
  });

  it('quotes the Cursor security page as it reads today', () => {
    const fact = field('cursor', 'autoRun');
    expect(note(fact)).toContain("it's disabled by default");
    for (const name of ['precedence', 'autoRun', 'extensions']) expect(readOnW1(field('cursor', name)), name).toBe(true);
  });

  it('confirms startup as a SessionStart matcher of Gemini CLI', () => {
    const fact = field('gemini-cli', 'autoRun');
    expect(note(fact)).toContain('confirmed matcher');
    expect(note(fact)).not.toContain('not a confirmed matcher');
    expect(readOnW1(fact)).toBe(true);
    expect(readOnW1(field('gemini-cli', 'contextNames'))).toBe(true);
  });

  it('keeps no Cline claim that no source read in W1 supports', () => {
    expect(note(field('cline', 'hooks'))).not.toContain('--yolo');
  });

  it('pins every Cline source to commit 92b9f72', () => {
    const text = JSON.stringify(agent('cline'));
    expect(text).not.toContain('ea16751d6ae3ae1e443681994906bf29cbc45039');
    for (const name of ['precedence', 'mcp', 'hooks', 'skills', 'contextFiles', 'permissions', 'autoRun', 'extensions']) {
      const fact = field('cline', name);
      for (const item of evidence(fact)) {
        if (item.source.includes('github.com/cline/cline')) expect(item.source, name).toContain('92b9f722a16d2a03c1153e12f9a0e759455f509d');
      }
      expect(readOnW1(fact), name).toBe(true);
    }
  });
});
