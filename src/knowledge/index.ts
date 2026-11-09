import { claudeCode } from './claude-code.ts';
import { cline } from './cline.ts';
import { codex } from './codex.ts';
import { copilotVscode } from './copilot-vscode.ts';
import { cursor } from './cursor.ts';
import { geminiCli } from './gemini-cli.ts';
import type { AgentKnowledge } from './types.ts';
import { windsurf } from './windsurf.ts';

import { shared } from './shared.ts';

export { shared };

export const knowledgeBase: readonly AgentKnowledge[] = [claudeCode, cursor, codex, geminiCli, copilotVscode, windsurf, cline];

export type * from './types.ts';

function newestDate(value: unknown, depth = 0): string {
  if (depth > 32 || typeof value !== 'object' || value === null) return '';
  let newest = '';
  const own = (value as { verifiedAt?: unknown }).verifiedAt;
  if (typeof own === 'string' && own > newest) newest = own;
  for (const inner of Object.values(value)) {
    const found = newestDate(inner, depth + 1);
    if (found > newest) newest = found;
  }
  return newest;
}

/** The date of the newest fact in the knowledge base (YYYY-MM-DD): what a JSON output says it was checked against. */
export function knowledgeDate(): string {
  return newestDate([knowledgeBase, shared]);
}
