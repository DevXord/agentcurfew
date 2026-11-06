import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { knowledgeBase, shared } from '../../src/knowledge/index.ts';
import { renderKnowledge } from '../../src/knowledge/render.ts';
import type { AgentKnowledge, Fact } from '../../src/knowledge/types.ts';
import { AGENT_FIELDS, validateKnowledge } from '../../src/knowledge/validate.ts';

function values<T>(fact: Fact<T>): readonly T[] {
  return fact.status === 'disputed' ? fact.variants.map((variant) => variant.value) : [fact.value];
}

function agent(id: AgentKnowledge['id']): AgentKnowledge {
  const found = knowledgeBase.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no knowledge about ${id}`);
  return found;
}

describe('knowledge base', () => {
  it('covers the agents of the plan, once each', () => {
    expect(knowledgeBase.map((entry) => entry.id).sort()).toEqual(['claude-code', 'cline', 'codex', 'copilot-vscode', 'cursor', 'gemini-cli', 'windsurf']);
  });

  it.each(knowledgeBase.map((entry) => [entry.id, entry] as const))('has a source and a date for every fact of %s', (id, entry) => {
    expect(validateKnowledge({ ...entry }, AGENT_FIELDS, id)).toEqual([]);
  });

  it('has a source and a date for the shared facts', () => {
    expect(validateKnowledge({ ...shared }, ['skillFormat', 'skillsLock'], 'shared')).toEqual([]);
  });

  it('records the top-level key of every MCP file of VS Code, which differs by file', () => {
    const [mcp] = values(agent('copilot-vscode').mcp);
    const key = (path: string) => {
      const file = mcp?.files.find((entry) => entry.path === path);
      if (file === undefined) throw new Error(`${path} is not listed`);
      return file.serversKey ?? mcp?.serversKey;
    };
    expect(key('.vscode/mcp.json')).toBe('servers');
    expect(key('.mcp.json')).toBe('mcpServers');
    expect(key('~/.copilot/mcp-config.json')).toBe('mcpServers');
  });

  it('lists both the current and the legacy project folder of Windsurf', () => {
    const paths = JSON.stringify(values(agent('windsurf').contextFiles));
    expect(paths).toContain('.devin/');
    expect(paths).toContain('.windsurf/');
  });

  it('keeps project paths inside the project', () => {
    for (const entry of knowledgeBase) {
      for (const field of AGENT_FIELDS) {
        const text = JSON.stringify(values(entry[field] as Fact<unknown>));
        for (const match of text.matchAll(/"path":"([^"]+)","scope":"project"/g)) {
          expect(match[1], `${entry.id}.${field}`).toMatch(/^(?![/~%]|[A-Za-z]:|.*\.\.)/);
        }
      }
    }
  });
});

describe('docs/knowledge.md', () => {
  it('is up to date (run npm run docs:knowledge)', () => {
    const file = readFileSync(new URL('../../docs/knowledge.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
    expect(file).toBe(renderKnowledge());
  });

  it('shows every disputed variant and every uncertain fact with its source', () => {
    const text = renderKnowledge();
    for (const entry of knowledgeBase) {
      for (const field of AGENT_FIELDS) {
        const fact = entry[field];
        if (fact.status === 'verified') continue;
        expect(text).toContain(fact.note.split('\n')[0]);
        if (fact.status === 'uncertain') expect(text).toContain(fact.source);
        else for (const variant of fact.variants) expect(text).toContain(variant.source);
      }
    }
  });
});
