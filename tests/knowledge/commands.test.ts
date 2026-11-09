import { describe, expect, it } from 'vitest';
import { claudeCode } from '../../src/knowledge/claude-code.ts';
import { codex } from '../../src/knowledge/codex.ts';
import type { CommandSettingsKnowledge, Fact } from '../../src/knowledge/types.ts';

function value(fact: Fact<CommandSettingsKnowledge> | undefined): CommandSettingsKnowledge {
  if (fact === undefined || fact.status === 'disputed') throw new Error('expected one value');
  return fact.value;
}

describe('settings that run commands', () => {
  it('lists the Claude Code keys that run a command from any settings file', () => {
    const settings = value(claudeCode.commands).settings;
    expect(settings.map((setting) => setting.key).sort()).toEqual(['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'fileSuggestion', 'gcpAuthRefresh', 'otelHeadersHelper', 'statusLine', 'subagentStatusLine']);
    expect(settings.find((setting) => setting.key === 'statusLine')).toMatchObject({ commandField: 'command', runs: 'session-start' });
    expect(settings.find((setting) => setting.key === 'apiKeyHelper')).toMatchObject({ runs: 'on-demand' });
    expect(settings.find((setting) => setting.key === 'apiKeyHelper')).not.toHaveProperty('commandField');
    expect(settings.every((setting) => setting.fromProject === undefined)).toBe(true);
    expect(claudeCode.commands?.status === 'disputed' ? '' : claudeCode.commands?.source).toMatch(/^https:\/\/code\.claude\.com\//);
  });

  it('marks Codex notify as ignored in a project file', () => {
    const settings = value(codex.commands).settings;
    expect(settings).toEqual([{ key: 'notify', runs: 'on-demand', fromProject: 'ignored' }]);
  });
});
