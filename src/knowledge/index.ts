import { claudeCode } from './claude-code.ts';
import { cline } from './cline.ts';
import { codex } from './codex.ts';
import { copilotVscode } from './copilot-vscode.ts';
import { cursor } from './cursor.ts';
import { geminiCli } from './gemini-cli.ts';
import type { AgentKnowledge } from './types.ts';
import { windsurf } from './windsurf.ts';

export { shared } from './shared.ts';

export const knowledgeBase: readonly AgentKnowledge[] = [claudeCode, cursor, codex, geminiCli, copilotVscode, windsurf, cline];

export type * from './types.ts';
