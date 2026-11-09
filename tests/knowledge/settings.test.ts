import { describe, expect, it } from 'vitest';
import { claudeCode } from '../../src/knowledge/claude-code.ts';
import { geminiCli } from '../../src/knowledge/gemini-cli.ts';
import type { Fact } from '../../src/knowledge/types.ts';

function one<T>(fact: Fact<T> | undefined): T {
  if (fact === undefined || fact.status === 'disputed') throw new Error('expected one value');
  return fact.value;
}

describe('settings that redirect an agent or install code', () => {
  it('lists the Claude Code env variables that send traffic elsewhere or wrap commands', () => {
    const env = one(claudeCode.env);
    expect(env.key).toBe('env');
    const effect = (name: string) => env.variables.find((variable) => variable.name === name);
    for (const name of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_BEDROCK_MANTLE_BASE_URL', 'ANTHROPIC_VERTEX_BASE_URL', 'ANTHROPIC_FOUNDRY_BASE_URL', 'ANTHROPIC_AWS_BASE_URL']) expect(effect(name)?.effect, name).toBe('endpoint');
    expect(effect('HTTPS_PROXY')?.effect).toBe('proxy');
    expect(effect('HTTP_PROXY')?.effect).toBe('proxy');
    expect(effect('ANTHROPIC_CUSTOM_HEADERS')?.effect).toBe('headers');
    expect(effect('CLAUDE_CODE_SHELL_PREFIX')?.effect).toBe('command-wrapper');
    expect(effect('OTEL_EXPORTER_OTLP_ENDPOINT')).toMatchObject({ effect: 'endpoint', fromProject: 'ignored' });
    expect(claudeCode.env?.status === 'disputed' ? '' : claudeCode.env?.source).toMatch(/^https:\/\/code\.claude\.com\//);
  });

  it('describes Claude Code plugins and marketplaces in settings', () => {
    const plugins = one(claudeCode.plugins);
    expect(plugins.enabledKey).toBe('enabledPlugins');
    expect(plugins.marketplacesKeys).toEqual(['extraKnownMarketplaces', 'additionalMarketplaces']);
    expect(plugins.marketplacesFromProject).toBe('needs-trust');
    const source = (type: string) => plugins.sources.find((entry) => entry.type === type);
    expect(source('github')?.where).toBe('remote');
    expect(source('git')).toMatchObject({ where: 'remote', urlField: 'url' });
    expect(source('url')).toMatchObject({ where: 'remote', urlField: 'url', headersHelper: 'headersHelper' });
    expect(source('file')?.where).toBe('local');
    expect(source('directory')?.where).toBe('local');
    expect(source('settings')?.where).toBe('inline');
    expect(plugins.autoUpdateField).toBe('autoUpdate');
  });

  it('knows the setting that turns every Claude Code hook off', () => {
    expect(one(claudeCode.hooksOff)).toMatchObject({ key: 'disableAllHooks' });
    expect(claudeCode.hooksOff?.status === 'disputed' ? '' : claudeCode.hooksOff?.source).toMatch(/^https:\/\/code\.claude\.com\/docs\/en\/settings-reference#disableallhooks$/);
  });

  it('knows the headersHelper command of remote Claude Code MCP servers', () => {
    expect(one(claudeCode.mcp)?.remote?.headersHelper).toBe('headersHelper');
  });

  it('keeps both readings of Gemini CLI context.fileName', () => {
    const fact = geminiCli.contextNames;
    expect(fact?.status).toBe('disputed');
    if (fact?.status !== 'disputed') return;
    expect(fact.variants.map((variant) => variant.value.replacesDefault).sort()).toEqual([false, true]);
    for (const variant of fact.variants) {
      expect(variant.value.key).toBe('context.fileName');
      expect(variant.value.locations.map((location) => location.path).sort()).toEqual(['**/<name>', '<name>', '~/.gemini/<name>']);
      expect(variant.source).toMatch(/^https:\/\/raw\.githubusercontent\.com\/google-gemini\/gemini-cli\//);
    }
  });
});
