import { describe, expect, it } from 'vitest';
import { verifiedOn } from '../../src/knowledge/define.ts';
import { validateKnowledge } from '../../src/knowledge/validate.ts';

const { verified, uncertain, disputed, evidence } = verifiedOn('2026-11-06');
const URL_A = 'https://example.test/a';
const URL_B = 'https://example.test/b';

const issues = (mcp: unknown) => validateKnowledge({ mcp }, ['mcp'], 'agent');

describe('validateKnowledge', () => {
  it('accepts sourced facts of every status', () => {
    expect(issues(verified(null, URL_A))).toEqual([]);
    expect(issues(uncertain(null, URL_A, 'inferred from the code'))).toEqual([]);
    expect(issues(disputed('two pages disagree', evidence(1, URL_A), evidence(2, URL_B)))).toEqual([]);
  });

  it('refuses a plain value in place of a fact', () => {
    expect(issues({ serversKey: 'mcpServers' })[0]).toContain('agent.mcp: must be a fact');
    expect(issues(undefined)[0]).toContain('agent.mcp: must be a fact');
  });

  it('refuses a fact without a source', () => {
    expect(issues({ status: 'verified', value: 1, verifiedAt: '2026-11-06' })).toEqual(['agent.mcp: source must be an https URL']);
  });

  it.each(['', 'from memory', 'http://example.test', 'file:///etc/passwd'])('refuses %j as a source', (source) => {
    expect(issues(verified(1, source))).toEqual(['agent.mcp: source must be an https URL']);
  });

  it('refuses a fact without a valid date', () => {
    expect(issues({ status: 'verified', value: 1, source: URL_A })).toEqual(['agent.mcp: verifiedAt must be YYYY-MM-DD']);
    expect(issues({ status: 'verified', value: 1, source: URL_A, verifiedAt: 'today' })).toHaveLength(1);
  });

  it('refuses an uncertain fact without a note', () => {
    expect(issues({ status: 'uncertain', value: 1, source: URL_A, verifiedAt: '2026-11-06' })).toEqual(['agent.mcp: an uncertain fact needs a note']);
  });

  it('checks every variant of a disputed fact', () => {
    const broken = { status: 'disputed', note: 'x', variants: [evidence(1, URL_A), { value: 2, verifiedAt: '2026-11-06' }] };
    expect(issues(broken)).toEqual(['agent.mcp.variants[1]: source must be an https URL']);
    expect(issues({ status: 'disputed', note: 'x', variants: [evidence(1, URL_A)] })).toEqual(['agent.mcp: a disputed fact needs at least two variants']);
  });

  it('finds facts nested below a plain object', () => {
    expect(validateKnowledge({ extra: { deep: [{ status: 'verified', value: 1 }] } }, [], 'agent')).toHaveLength(2);
  });
});
